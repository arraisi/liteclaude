'use strict';

const http = require('http');
const { Readable } = require('stream');
const { rewriteModel } = require('./rewrite');

// Headers that must not be forwarded verbatim: fetch() decodes the body, and
// hop-by-hop headers belong to each connection, not the message.
const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

const FORWARD_REQUEST_HEADERS = new Set([
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-beta',
  'user-agent',
]);

function createUsageTracker() {
  let inputTokens = 0;
  let outputTokens = 0;
  let buffer = '';

  function scan(text) {
    // Works for both SSE events and plain JSON bodies. message_start carries
    // input_tokens; message_delta carries cumulative output_tokens, so keep
    // the max seen per response.
    for (const match of text.matchAll(/"input_tokens"\s*:\s*(\d+)/g)) {
      inputTokens = Math.max(inputTokens, parseInt(match[1], 10));
    }
    for (const match of text.matchAll(/"output_tokens"\s*:\s*(\d+)/g)) {
      outputTokens = Math.max(outputTokens, parseInt(match[1], 10));
    }
  }

  return {
    feed(chunk) {
      buffer += chunk;
      // Scan complete lines; keep the tail in case a number is split across chunks.
      const lastNewline = buffer.lastIndexOf('\n');
      if (lastNewline >= 0) {
        scan(buffer.slice(0, lastNewline + 1));
        buffer = buffer.slice(lastNewline + 1);
      }
    },
    finish() {
      scan(buffer);
      buffer = '';
      return { inputTokens, outputTokens };
    },
  };
}

function createProxy(config) {
  const state = {
    preset: config.defaultPreset,
    startedAt: Date.now(),
    usage: {}, // preset name -> { requests, inputTokens, outputTokens }
  };

  function usageFor(presetName) {
    if (!state.usage[presetName]) {
      state.usage[presetName] = { requests: 0, inputTokens: 0, outputTokens: 0 };
    }
    return state.usage[presetName];
  }

  function json(res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload, null, 2) + '\n');
  }

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  function statusPayload() {
    return {
      service: 'liteclaude',
      preset: state.preset,
      presets: Object.keys(config.presets),
      baseUrl: config.litellm.baseUrl,
      apiKey: config.apiKey ? 'set' : 'missing',
      uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
      port: config.port,
    };
  }

  function costPayload() {
    const perPreset = {};
    let totalCost = 0;
    let costKnown = true;
    for (const [name, usage] of Object.entries(state.usage)) {
      const pricing = (config.presets[name] || {}).pricing;
      const entry = { ...usage };
      if (pricing) {
        entry.costUsd = Number(
          (
            (usage.inputTokens / 1e6) * (pricing.inputPerM || 0) +
            (usage.outputTokens / 1e6) * (pricing.outputPerM || 0)
          ).toFixed(4)
        );
        totalCost += entry.costUsd;
      } else {
        costKnown = false;
      }
      perPreset[name] = entry;
    }
    return {
      sinceProxyStart: new Date(state.startedAt).toISOString(),
      perPreset,
      totalCostUsd: costKnown ? Number(totalCost.toFixed(4)) : null,
    };
  }

  async function handleMode(req, res) {
    const body = (await readBody(req)).toString();
    let preset;
    try {
      preset = JSON.parse(body).preset;
    } catch {
      preset = new URLSearchParams(body).get('preset') || new URLSearchParams(body).get('backend');
    }
    if (!preset || !config.presets[preset]) {
      return json(res, 400, {
        error: `Unknown preset: ${preset}`,
        presets: Object.keys(config.presets),
      });
    }
    state.preset = preset;
    json(res, 200, { ok: true, preset });
  }

  async function forward(req, res) {
    let body = await readBody(req);
    const presetName = state.preset;
    const preset = config.presets[presetName] || {};

    const isMessages =
      req.method === 'POST' &&
      req.url.startsWith('/v1/messages') &&
      !req.url.includes('count_tokens');

    if (isMessages) {
      try {
        body = Buffer.from(JSON.stringify(rewriteModel(JSON.parse(body.toString()), preset)));
      } catch {
        // Not JSON — forward untouched.
      }
    }

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (FORWARD_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    headers.authorization = `Bearer ${config.apiKey}`;
    headers['x-api-key'] = config.apiKey;

    const url = config.litellm.baseUrl.replace(/\/+$/, '') + req.url;
    let upstream;
    try {
      upstream = await fetch(url, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
    } catch (err) {
      return json(res, 502, {
        error: 'liteclaude: LiteLLM unreachable',
        baseUrl: config.litellm.baseUrl,
        message: err.message,
      });
    }

    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (!STRIP_RESPONSE_HEADERS.has(name)) responseHeaders[name] = value;
    }
    res.writeHead(upstream.status, responseHeaders);

    if (!upstream.body) return res.end();

    const tracker = isMessages && upstream.ok ? createUsageTracker() : null;
    const stream = Readable.fromWeb(upstream.body);
    if (tracker) {
      stream.on('data', (chunk) => tracker.feed(chunk.toString()));
      stream.on('end', () => {
        const { inputTokens, outputTokens } = tracker.finish();
        const usage = usageFor(presetName);
        usage.requests += 1;
        usage.inputTokens += inputTokens;
        usage.outputTokens += outputTokens;
      });
    }
    stream.pipe(res);
    stream.on('error', () => res.destroy());
  }

  const server = http.createServer((req, res) => {
    const handler = async () => {
      if (req.url === '/_proxy/status' && req.method === 'GET') return json(res, 200, statusPayload());
      if (req.url === '/_proxy/cost' && req.method === 'GET') return json(res, 200, costPayload());
      if (req.url === '/_proxy/mode' && req.method === 'POST') return handleMode(req, res);
      if (req.url === '/_proxy/shutdown' && req.method === 'POST') {
        json(res, 200, { ok: true, message: 'liteclaude proxy shutting down' });
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 500).unref();
        return;
      }
      return forward(req, res);
    };
    handler().catch((err) => {
      if (!res.headersSent) {
        json(res, 502, { error: 'liteclaude proxy error', message: err.message });
      } else {
        res.destroy();
      }
    });
  });

  return { server, state };
}

module.exports = { createProxy, createUsageTracker };
