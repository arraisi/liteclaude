# liteclaude — design

Use Claude Code's autonomous agent loop with any model behind a LiteLLM proxy.
A deepclaude-style local proxy + CLI wrapper: Claude Code's tool loop stays
unchanged; API calls go through `localhost:3200`, which rewrites the model name
per an active *preset* and forwards to your LiteLLM proxy with your API key.
Presets are switchable mid-session via slash commands — no restart.

## Architecture

```
claude (CLI, agent loop unchanged)
  └─ ANTHROPIC_BASE_URL=http://127.0.0.1:3200
       └─ liteclaude proxy (single-process Node, zero deps)
            ├─ /_proxy/mode      POST → switch active model preset
            ├─ /_proxy/status    GET  → active preset, uptime, config summary
            ├─ /_proxy/cost      GET  → token usage + cost per preset
            ├─ /_proxy/shutdown  POST → stop proxy
            └─ /v1/messages      → rewrites `model` per active preset,
                                   injects Authorization, forwards to LiteLLM
```

LiteLLM speaks the Anthropic Messages API natively (`/v1/messages`), so the
proxy is a thin rewrite-and-forward layer, not a format translator.

## Components

### CLI (`bin/liteclaude.js`)

| Command | Behavior |
|---|---|
| `liteclaude [claude args…]` | Ensure proxy running, launch `claude` with env pointed at it |
| `liteclaude --status` | Presets, active preset, key presence, proxy state |
| `liteclaude --switch <preset>` | Switch preset on running proxy |
| `liteclaude --cost` | Token usage + cost per preset since proxy start |
| `liteclaude --benchmark` | Latency test per preset against LiteLLM |
| `liteclaude --install-commands` | Generate `~/.claude/commands/<preset>.md` slash commands |
| `liteclaude --init` | Write starter `~/.liteclaude.json` |
| `liteclaude --stop` | Shut proxy down |
| `liteclaude proxy` | (internal) run proxy in foreground |

The launcher sets `ANTHROPIC_BASE_URL` and a placeholder
`ANTHROPIC_AUTH_TOKEN` only for the child process — the real key never enters
Claude Code's environment; the proxy injects it upstream.

### Proxy (`lib/proxy.js`)

- Buffers `/v1/messages` request bodies, rewrites `model` by tier (see below),
  forwards to `<baseUrl>/v1/messages` with `Authorization: Bearer <key>` and
  `x-api-key`.
- Streams responses back untouched; strips hop-by-hop/encoding headers.
- Tracks `input_tokens` / `output_tokens` from response bodies (SSE
  `message_start` / `message_delta` usage events, or plain JSON) into
  per-preset counters for `/_proxy/cost`.
- All other paths forward as-is (passthrough).

### Model tier mapping (`lib/rewrite.js`)

Claude Code sends Anthropic model names. The proxy maps them by tier keyword:
name contains `opus` → preset's `opus` alias, `haiku` → `haiku`, otherwise
`sonnet`. Missing tier falls back to sonnet → opus → haiku.

### Config (`lib/config.js`, `~/.liteclaude.json`)

```json
{
  "litellm": { "baseUrl": "https://litellm.example.com", "apiKeyEnv": "LITELLM_API_KEY" },
  "port": 3200,
  "defaultPreset": "deepseek",
  "presets": {
    "deepseek": {
      "opus": "deepseek-v3", "sonnet": "deepseek-v3", "haiku": "deepseek-chat",
      "pricing": { "inputPerM": 0.44, "outputPerM": 0.87 }
    },
    "claude": {
      "opus": "claude-opus-4-8", "sonnet": "claude-sonnet-4-6", "haiku": "claude-haiku-4-5"
    }
  }
}
```

Env overrides: `LITELLM_BASE_URL`, `LITELLM_API_KEY` (or the name in
`apiKeyEnv`), `LITECLAUDE_PORT`. `pricing` is optional; without it `--cost`
shows tokens only.

## Error handling

- LiteLLM unreachable → 502 with a clear liteclaude-tagged message.
- Unknown preset on `/_proxy/mode` or `--switch` → 400 + list of valid presets.
- Port already serving a liteclaude proxy → reuse it; otherwise report conflict.
- API key never logged or echoed.

## Testing

`node --test` (zero deps): unit tests for config loading/overrides and tier
rewriting; integration test spinning the proxy against a fake upstream server
asserting model rewrite, auth injection, preset switching, and usage counting.
Manual smoke: launch against real LiteLLM, `/_proxy/status`, switch mid-session.
