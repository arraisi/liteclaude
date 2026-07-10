'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_PATH = path.join(os.homedir(), '.liteclaude.json');

const DEFAULTS = {
  port: 3200,
  defaultPreset: null,
  litellm: { baseUrl: '', apiKeyEnv: 'LITELLM_API_KEY' },
  presets: {},
};

function loadConfig({ configPath = CONFIG_PATH, env = process.env } = {}) {
  let raw = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid JSON in ${configPath}: ${err.message}`);
    }
  }

  const config = {
    ...DEFAULTS,
    ...raw,
    litellm: { ...DEFAULTS.litellm, ...(raw.litellm || {}) },
    presets: raw.presets || {},
    configPath,
  };

  if (env.LITELLM_BASE_URL) config.litellm.baseUrl = env.LITELLM_BASE_URL;
  if (env.LITECLAUDE_PORT) config.port = parseInt(env.LITECLAUDE_PORT, 10);

  const keyEnv = config.litellm.apiKeyEnv || 'LITELLM_API_KEY';
  config.apiKey = env[keyEnv] || env.LITELLM_API_KEY || config.litellm.apiKey || null;

  const names = Object.keys(config.presets);
  if (!config.defaultPreset || !config.presets[config.defaultPreset]) {
    config.defaultPreset = names[0] || null;
  }

  return config;
}

function validateConfig(config) {
  const problems = [];
  if (!config.litellm.baseUrl) {
    problems.push('LiteLLM base URL missing (set litellm.baseUrl in config or LITELLM_BASE_URL)');
  }
  if (!config.apiKey) {
    const keyEnv = config.litellm.apiKeyEnv || 'LITELLM_API_KEY';
    problems.push(`API key missing (set ${keyEnv} env var or litellm.apiKey in config)`);
  }
  if (!Object.keys(config.presets).length) {
    problems.push(`No presets defined in ${config.configPath} (run: liteclaude --init)`);
  }
  return problems;
}

const STARTER_CONFIG = {
  litellm: {
    baseUrl: 'https://your-litellm.example.com',
    apiKeyEnv: 'LITELLM_API_KEY',
  },
  port: 3200,
  defaultPreset: 'deepseek',
  presets: {
    deepseek: {
      opus: 'deepseek-v3',
      sonnet: 'deepseek-v3',
      haiku: 'deepseek-chat',
      pricing: { inputPerM: 0.44, outputPerM: 0.87 },
    },
    claude: {
      opus: 'claude-opus-4-8',
      sonnet: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5',
      pricing: { inputPerM: 3.0, outputPerM: 15.0 },
    },
  },
};

module.exports = { loadConfig, validateConfig, CONFIG_PATH, STARTER_CONFIG };
