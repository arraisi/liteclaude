'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig, validateConfig } = require('../lib/config');

function tempConfig(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'liteclaude-')), 'config.json');
  fs.writeFileSync(file, JSON.stringify(contents));
  return file;
}

test('loads config file and resolves API key from apiKeyEnv', () => {
  const configPath = tempConfig({
    litellm: { baseUrl: 'https://llm.example.com', apiKeyEnv: 'MY_KEY' },
    defaultPreset: 'fast',
    presets: { fast: { sonnet: 'model-a' } },
  });
  const config = loadConfig({ configPath, env: { MY_KEY: 'secret' } });
  assert.strictEqual(config.litellm.baseUrl, 'https://llm.example.com');
  assert.strictEqual(config.apiKey, 'secret');
  assert.strictEqual(config.defaultPreset, 'fast');
  assert.deepStrictEqual(validateConfig(config), []);
});

test('env vars override config file', () => {
  const configPath = tempConfig({
    litellm: { baseUrl: 'https://old.example.com' },
    port: 3200,
    presets: { p: { sonnet: 'm' } },
  });
  const config = loadConfig({
    configPath,
    env: { LITELLM_BASE_URL: 'https://new.example.com', LITELLM_API_KEY: 'k', LITECLAUDE_PORT: '4000' },
  });
  assert.strictEqual(config.litellm.baseUrl, 'https://new.example.com');
  assert.strictEqual(config.port, 4000);
  assert.strictEqual(config.apiKey, 'k');
});

test('falls back to first preset when defaultPreset missing', () => {
  const configPath = tempConfig({
    litellm: { baseUrl: 'https://x.example.com' },
    defaultPreset: 'nope',
    presets: { alpha: { sonnet: 'a' }, beta: { sonnet: 'b' } },
  });
  const config = loadConfig({ configPath, env: { LITELLM_API_KEY: 'k' } });
  assert.strictEqual(config.defaultPreset, 'alpha');
});

test('missing config file yields validation problems, not a crash', () => {
  const config = loadConfig({ configPath: '/nonexistent/liteclaude.json', env: {} });
  const problems = validateConfig(config);
  assert.strictEqual(problems.length, 3);
});

test('invalid JSON raises a clear error', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'liteclaude-')), 'bad.json');
  fs.writeFileSync(file, '{nope');
  assert.throws(() => loadConfig({ configPath: file, env: {} }), /Invalid JSON/);
});
