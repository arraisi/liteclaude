'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createProxy, createUsageTracker } = require('../lib/proxy');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function withProxy(fn) {
  // Fake LiteLLM upstream: echoes the model it received, returns usage.
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    received.push({ url: req.url, headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'message',
        model: body ? body.model : null,
        usage: { input_tokens: 10, output_tokens: 7 },
      })
    );
  });
  const upstreamPort = await listen(upstream);

  const config = {
    port: 0,
    defaultPreset: 'cheap',
    litellm: { baseUrl: `http://127.0.0.1:${upstreamPort}` },
    apiKey: 'test-key',
    presets: {
      cheap: { sonnet: 'cheap-sonnet', opus: 'cheap-opus', pricing: { inputPerM: 1, outputPerM: 2 } },
      fancy: { sonnet: 'fancy-sonnet' },
    },
  };
  const { server, state } = createProxy(config);
  const proxyPort = await listen(server);
  const base = `http://127.0.0.1:${proxyPort}`;

  try {
    await fn({ base, received, state });
  } finally {
    server.close();
    upstream.close();
  }
}

test('rewrites model, injects auth, counts usage', async () => {
  await withProxy(async ({ base, received, state }) => {
    const response = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 5, messages: [] }),
    });
    const payload = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(payload.model, 'cheap-sonnet');
    assert.strictEqual(received[0].headers.authorization, 'Bearer test-key');
    assert.strictEqual(received[0].headers['x-api-key'], 'test-key');
    // Usage recorded on stream end — give the event loop a tick.
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(state.usage.cheap, { requests: 1, inputTokens: 10, outputTokens: 7 });
  });
});

test('switches preset via /_proxy/mode and rejects unknown presets', async () => {
  await withProxy(async ({ base, received }) => {
    const bad = await fetch(`${base}/_proxy/mode`, { method: 'POST', body: JSON.stringify({ preset: 'nope' }) });
    assert.strictEqual(bad.status, 400);
    assert.deepStrictEqual((await bad.json()).presets, ['cheap', 'fancy']);

    const ok = await fetch(`${base}/_proxy/mode`, { method: 'POST', body: 'preset=fancy' });
    assert.strictEqual((await ok.json()).preset, 'fancy');

    await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [] }),
    });
    assert.strictEqual(received[0].body.model, 'fancy-sonnet');
  });
});

test('status and cost endpoints report state', async () => {
  await withProxy(async ({ base }) => {
    const status = await (await fetch(`${base}/_proxy/status`)).json();
    assert.strictEqual(status.service, 'liteclaude');
    assert.strictEqual(status.preset, 'cheap');
    assert.strictEqual(status.apiKey, 'set');

    await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [] }),
    });
    await new Promise((r) => setTimeout(r, 50));

    const cost = await (await fetch(`${base}/_proxy/cost`)).json();
    assert.strictEqual(cost.perPreset.cheap.requests, 1);
    // 10/1e6 * $1 + 7/1e6 * $2 rounds to 0.
    assert.strictEqual(typeof cost.perPreset.cheap.costUsd, 'number');
  });
});

test('returns 502 with clear message when LiteLLM is unreachable', async () => {
  const config = {
    port: 0,
    defaultPreset: 'p',
    litellm: { baseUrl: 'http://127.0.0.1:1' },
    apiKey: 'k',
    presets: { p: { sonnet: 's' } },
  };
  const { server } = createProxy(config);
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [] }),
    });
    assert.strictEqual(response.status, 502);
    assert.match((await response.json()).error, /LiteLLM unreachable/);
  } finally {
    server.close();
  }
});

test('usage tracker takes max across SSE events, handles split chunks', () => {
  const tracker = createUsageTracker();
  tracker.feed('data: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":1}}}\n');
  tracker.feed('data: {"type":"message_delta","usage":{"output_to');
  tracker.feed('kens":42}}\n');
  assert.deepStrictEqual(tracker.finish(), { inputTokens: 100, outputTokens: 42 });
});
