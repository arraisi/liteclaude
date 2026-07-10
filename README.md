# liteclaude

Use Claude Code's autonomous agent loop with **any model behind a LiteLLM proxy** — DeepSeek, GPT, Gemini, Llama, or Claude itself. Same UX as [deepclaude](https://github.com/aattaran/deepclaude), but with LiteLLM as the single backend and live **model preset switching** mid-session.

```
Your terminal
  └─ Claude Code CLI (tool loop, file editing, bash, git — unchanged)
       └─ liteclaude proxy (localhost:3200)
            └─ your LiteLLM gateway → any model
```

Everything works: file reading/editing, bash execution, multi-step autonomous loops, subagents, git. The only difference is which model thinks.

## Requirements

- Node.js ≥ 18 (Claude Code already requires it)
- Claude Code CLI installed
- A LiteLLM proxy with the Anthropic `/v1/messages` route (LiteLLM ≥ 1.40 has it natively)

## Install

```bash
git clone git@github.com:arraisi/liteclaude.git
cd liteclaude
./install.sh
```

The installer prompts for your LiteLLM base URL and API key (input hidden), validates them against `/v1/models`, **scans the available models to auto-generate presets** in `~/.liteclaude.json`, optionally saves the key to your shell rc, and links the `liteclaude` CLI. Non-interactive: set `LITELLM_BASE_URL` and `LITELLM_API_KEY` first.

### Manual setup (alternative)

```bash
npm link                                # or: sudo ln -s "$(pwd)/bin/liteclaude.js" /usr/local/bin/liteclaude
liteclaude --init                       # writes starter ~/.liteclaude.json
$EDITOR ~/.liteclaude.json              # set litellm.baseUrl + preset model aliases
export LITELLM_API_KEY="sk-..."         # your LiteLLM key (put in ~/.zshrc)
liteclaude --status                     # verify config
```

Example `~/.liteclaude.json`:

```json
{
  "litellm": { "baseUrl": "https://your-litellm.example.com", "apiKeyEnv": "LITELLM_API_KEY" },
  "port": 3200,
  "defaultPreset": "deepseek",
  "presets": {
    "deepseek": {
      "opus": "deepseek/deepseek-v4-pro",
      "sonnet": "deepseek/deepseek-v4-pro",
      "haiku": "deepseek/deepseek-v4-pro",
      "pricing": { "inputPerM": 0.44, "outputPerM": 0.87 }
    },
    "claude": {
      "opus": "claude-opus-4-8",
      "sonnet": "claude-sonnet-4-6",
      "haiku": "claude-haiku-4-5-20251001"
    }
  }
}
```

Each preset maps Claude Code's three model tiers (opus / sonnet / haiku) to model names on your LiteLLM gateway. Missing tiers fall back to sonnet → opus → haiku. `pricing` is optional and only feeds `--cost`.

## Use

```bash
liteclaude                     # launch Claude Code through the proxy
liteclaude --status            # proxy state, presets, key presence
liteclaude --switch claude     # switch preset mid-session, no restart
liteclaude --cost              # token usage + cost per preset
liteclaude --benchmark         # latency test per preset
liteclaude --stop              # stop the proxy
```

### Slash commands (switch from inside Claude Code)

```bash
liteclaude --install-commands
```

Generates `~/.claude/commands/<preset>.md` for each preset — then type `/deepseek`, `/claude`, etc. inside any Claude Code session to switch instantly.

## How it works

`liteclaude` starts a zero-dependency local proxy and launches `claude` with `ANTHROPIC_BASE_URL` pointed at it. The proxy:

- rewrites the `model` field of every `/v1/messages` request per the active preset's tier map,
- injects your LiteLLM API key upstream (the key never enters Claude Code's environment),
- streams responses back untouched,
- counts tokens per preset for `/_proxy/cost`.

Control endpoints on the proxy:

| Endpoint | Method | Purpose |
|---|---|---|
| `/_proxy/status` | GET | active preset, uptime, config summary |
| `/_proxy/mode` | POST | switch preset (`{"preset":"name"}` or `preset=name`) |
| `/_proxy/cost` | GET | token usage + cost per preset |
| `/_proxy/shutdown` | POST | stop the proxy |

## Caveats

- Image/vision input and prompt-caching behavior depend on the model behind LiteLLM.
- Cost figures come from your `pricing` config, not LiteLLM's billing — treat as estimates.
- The proxy binds to `127.0.0.1` only.

## Development

```bash
npm test    # node --test, zero dependencies
```

Design doc: [`docs/superpowers/specs/2026-07-10-liteclaude-design.md`](docs/superpowers/specs/2026-07-10-liteclaude-design.md)
