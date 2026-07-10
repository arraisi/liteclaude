#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { loadConfig, validateConfig, CONFIG_PATH, STARTER_CONFIG } = require('../lib/config');
const { createProxy } = require('../lib/proxy');

const HELP = `liteclaude — Claude Code's autonomous agent loop on any LiteLLM backend

Usage:
  liteclaude [claude args…]        Launch Claude Code through the proxy
  liteclaude --status              Show proxy state, presets, key presence
  liteclaude --switch <preset>     Switch active preset (no restart needed)
  liteclaude --cost                Token usage + cost per preset
  liteclaude --benchmark           Latency test per preset against LiteLLM
  liteclaude --install-commands    Generate ~/.claude/commands/<preset>.md
  liteclaude --init                Write starter ~/.liteclaude.json
  liteclaude --stop                Shut the proxy down
  liteclaude --help                This help

Config: ~/.liteclaude.json (env overrides: LITELLM_BASE_URL, LITELLM_API_KEY, LITECLAUDE_PORT)
`;

function proxyUrl(config, pathname = '') {
  return `http://127.0.0.1:${config.port}${pathname}`;
}

async function proxyRequest(config, pathname, options = {}) {
  const response = await fetch(proxyUrl(config, pathname), {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 3000),
  });
  return response.json();
}

async function proxyRunning(config) {
  try {
    const status = await proxyRequest(config, '/_proxy/status', { timeoutMs: 1000 });
    return status.service === 'liteclaude' ? status : null;
  } catch {
    return null;
  }
}

async function ensureProxy(config) {
  const existing = await proxyRunning(config);
  if (existing) return existing;

  const child = spawn(process.execPath, [__filename, 'proxy'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const status = await proxyRunning(config);
    if (status) return status;
  }
  throw new Error(
    `Proxy failed to start on port ${config.port}. ` +
      `If another service owns that port, change "port" in ${CONFIG_PATH}.`
  );
}

function requireValidConfig(config) {
  const problems = validateConfig(config);
  if (problems.length) {
    console.error('liteclaude: configuration problems:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}

async function cmdLaunch(config, claudeArgs) {
  requireValidConfig(config);
  const status = await ensureProxy(config);
  console.error(`liteclaude: proxy on port ${config.port}, preset "${status.preset}"`);

  const child = spawn('claude', claudeArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: proxyUrl(config),
      // Placeholder — the proxy injects the real LiteLLM key upstream, so the
      // key never enters Claude Code's environment.
      ANTHROPIC_AUTH_TOKEN: 'liteclaude-proxy',
    },
  });
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : code ?? 0);
  });
}

function cmdProxy(config) {
  requireValidConfig(config);
  const { server } = createProxy(config);
  server.on('error', (err) => {
    console.error(`liteclaude proxy: ${err.message}`);
    process.exit(1);
  });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`liteclaude proxy listening on ${proxyUrl(config)} (preset: ${config.defaultPreset})`);
  });
}

async function cmdStatus(config) {
  const status = await proxyRunning(config);
  if (status) {
    console.log(`Proxy:    running on port ${status.port} (up ${status.uptimeSeconds}s)`);
    console.log(`Preset:   ${status.preset}`);
  } else {
    console.log(`Proxy:    not running (starts automatically with \`liteclaude\`)`);
    console.log(`Preset:   ${config.defaultPreset ?? '(none)'} (default)`);
  }
  console.log(`LiteLLM:  ${config.litellm.baseUrl || '(not set)'}`);
  console.log(`API key:  ${config.apiKey ? 'set' : 'MISSING'}`);
  console.log(`Presets:`);
  for (const [name, preset] of Object.entries(config.presets)) {
    const tiers = ['opus', 'sonnet', 'haiku']
      .map((tier) => `${tier}=${preset[tier] || '-'}`)
      .join(' ');
    console.log(`  ${name}: ${tiers}`);
  }
  const problems = validateConfig(config);
  if (problems.length) {
    console.log('Problems:');
    for (const problem of problems) console.log(`  - ${problem}`);
  }
}

async function cmdSwitch(config, preset) {
  if (!preset) {
    console.error(`Usage: liteclaude --switch <preset>  (presets: ${Object.keys(config.presets).join(', ')})`);
    process.exit(1);
  }
  const running = await proxyRunning(config);
  if (!running) {
    console.error('Proxy not running — start it with `liteclaude` first.');
    process.exit(1);
  }
  const result = await proxyRequest(config, '/_proxy/mode', {
    method: 'POST',
    body: JSON.stringify({ preset }),
  });
  if (result.ok) {
    console.log(`Switched to preset "${preset}".`);
  } else {
    console.error(`${result.error} (presets: ${(result.presets || []).join(', ')})`);
    process.exit(1);
  }
}

async function cmdCost(config) {
  const running = await proxyRunning(config);
  if (!running) {
    console.error('Proxy not running — no usage to report.');
    process.exit(1);
  }
  const cost = await proxyRequest(config, '/_proxy/cost');
  console.log(`Usage since ${cost.sinceProxyStart}:`);
  const entries = Object.entries(cost.perPreset);
  if (!entries.length) console.log('  (no requests yet)');
  for (const [name, usage] of entries) {
    const costText = usage.costUsd != null ? ` — $${usage.costUsd}` : '';
    console.log(
      `  ${name}: ${usage.requests} requests, ${usage.inputTokens} in / ${usage.outputTokens} out tokens${costText}`
    );
  }
  if (cost.totalCostUsd != null) console.log(`Total: $${cost.totalCostUsd}`);
}

async function cmdStop(config) {
  const running = await proxyRunning(config);
  if (!running) {
    console.log('Proxy not running.');
    return;
  }
  await proxyRequest(config, '/_proxy/shutdown', { method: 'POST' }).catch(() => {});
  console.log('Proxy stopped.');
}

async function cmdBenchmark(config) {
  requireValidConfig(config);
  console.log(`Benchmarking against ${config.litellm.baseUrl} (1-token request per preset)…`);
  for (const [name, preset] of Object.entries(config.presets)) {
    const model = preset.sonnet || preset.opus || preset.haiku;
    const started = Date.now();
    try {
      const response = await fetch(config.litellm.baseUrl.replace(/\/+$/, '') + '/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          authorization: `Bearer ${config.apiKey}`,
          'x-api-key': config.apiKey,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      const elapsed = Date.now() - started;
      if (response.ok) {
        console.log(`  ${name} (${model}): ${elapsed}ms`);
      } else {
        console.log(`  ${name} (${model}): HTTP ${response.status} after ${elapsed}ms`);
      }
      await response.arrayBuffer().catch(() => {});
    } catch (err) {
      console.log(`  ${name} (${model}): failed — ${err.message}`);
    }
  }
}

function cmdInstallCommands(config) {
  const commandsDir = path.join(os.homedir(), '.claude', 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });
  for (const name of Object.keys(config.presets)) {
    const file = path.join(commandsDir, `${name}.md`);
    const content = `Switch the liteclaude model proxy to the "${name}" preset. Run this command silently and report the result:
curl -sX POST http://127.0.0.1:${config.port}/_proxy/mode -H "content-type: application/json" -d '{"preset":"${name}"}'
If successful, say: "Switched to ${name}."
`;
    fs.writeFileSync(file, content);
    console.log(`Wrote ${file} — use /${name} inside Claude Code`);
  }
}

function cmdInit() {
  if (fs.existsSync(CONFIG_PATH)) {
    console.error(`${CONFIG_PATH} already exists — edit it directly.`);
    process.exit(1);
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(STARTER_CONFIG, null, 2) + '\n');
  console.log(`Wrote starter config to ${CONFIG_PATH}.`);
  console.log('Edit litellm.baseUrl and the preset model aliases, then set LITELLM_API_KEY.');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === '--help' || command === '-h') return console.log(HELP);
  if (command === '--init') return cmdInit();

  const config = loadConfig();

  switch (command) {
    case 'proxy':
      return cmdProxy(config);
    case '--status':
      return cmdStatus(config);
    case '--switch':
      return cmdSwitch(config, rest[0]);
    case '--cost':
      return cmdCost(config);
    case '--stop':
      return cmdStop(config);
    case '--benchmark':
      return cmdBenchmark(config);
    case '--install-commands':
      return cmdInstallCommands(config);
    default:
      return cmdLaunch(config, process.argv.slice(2));
  }
}

main().catch((err) => {
  console.error(`liteclaude: ${err.message}`);
  process.exit(1);
});
