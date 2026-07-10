#!/usr/bin/env node
'use strict';

// Reads a /v1/models JSON payload on stdin, builds ~/.liteclaude.json presets
// from the models found on the gateway. Usage:
//   curl .../v1/models | node scripts/generate-config.js <baseUrl> [outPath]

const fs = require('fs');
const os = require('os');
const path = require('path');

const baseUrl = process.argv[2];
const outPath = process.argv[3] || path.join(os.homedir(), '.liteclaude.json');
if (!baseUrl) {
  console.error('usage: generate-config.js <baseUrl> [outPath] < models.json');
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (err) {
  console.error(`generate-config: invalid models JSON on stdin: ${err.message}`);
  process.exit(1);
}
const ids = (payload.data || []).map((m) => m.id).filter(Boolean);
if (!ids.length) {
  console.error('generate-config: no models in payload');
  process.exit(1);
}

const find = (patterns) => {
  for (const pattern of patterns) {
    const hit = ids.find((id) => pattern.test(id));
    if (hit) return hit;
  }
  return null;
};

const presets = {};

const deepseek = find([/deepseek.*pro/i, /deepseek/i]);
if (deepseek) {
  presets.deepseek = {
    opus: deepseek,
    sonnet: deepseek,
    haiku: find([/deepseek.*chat/i]) || deepseek,
  };
}

const claudeOpus = find([/claude.*opus/i]);
const claudeSonnet = find([/claude.*sonnet/i, /claude-fable/i]);
const claudeHaiku = find([/claude.*haiku/i]);
if (claudeOpus || claudeSonnet || claudeHaiku) {
  presets.claude = {
    opus: claudeOpus || claudeSonnet || claudeHaiku,
    sonnet: claudeSonnet || claudeOpus || claudeHaiku,
    haiku: claudeHaiku || claudeSonnet || claudeOpus,
  };
}

const gptBig = find([/^gpt-5\.\d/i, /^gpt-5(?!-mini)/i, /^gpt-4o$/i]);
const gptSmall = find([/^gpt-5.*mini/i, /^gpt-4o-mini/i]);
if (gptBig || gptSmall) {
  presets.gpt = {
    opus: gptBig || gptSmall,
    sonnet: gptBig || gptSmall,
    haiku: gptSmall || gptBig,
  };
}

const geminiBig = find([/gemini.*3\.5/i, /gemini.*pro/i, /gemini/i]);
const geminiSmall = find([/gemini.*flash/i]) || geminiBig;
if (geminiBig) {
  presets.gemini = { opus: geminiBig, sonnet: geminiBig, haiku: geminiSmall };
}

if (!Object.keys(presets).length) {
  const first = ids[0];
  presets.default = { opus: first, sonnet: first, haiku: first };
}

const preference = ['deepseek', 'gpt', 'gemini', 'claude', 'default'];
const defaultPreset = preference.find((name) => presets[name]) || Object.keys(presets)[0];

const config = {
  litellm: { baseUrl, apiKeyEnv: 'LITELLM_API_KEY' },
  port: 3200,
  defaultPreset,
  presets,
};

fs.writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
console.log(`Default preset: ${defaultPreset}`);
for (const [name, preset] of Object.entries(presets)) {
  console.log(`  ${name}: opus=${preset.opus} sonnet=${preset.sonnet} haiku=${preset.haiku}`);
}
