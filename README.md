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
    },
    "gpt": {
      "opus": "gpt-5.5-2026-04-23",
      "sonnet": "gpt-5.5-2026-04-23",
      "haiku": "gpt-5-mini"
    },
    "gemini": {
      "opus": "gemini/gemini-3.5-flash",
      "sonnet": "gemini/gemini-3.5-flash",
      "haiku": "gemini/gemini-2.5-flash"
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

### Switching models

Any model on your LiteLLM gateway works — GPT, Gemini, DeepSeek, Claude, Llama. Switch the active preset mid-session:

```bash
liteclaude --switch gpt        # from another terminal
```

or type `/gpt` inside Claude Code (after `--install-commands`). Claude Code keeps sending `claude-*` model names; the proxy rewrites them to the active preset's aliases, and LiteLLM translates the Anthropic Messages format for non-Anthropic backends.

> **Caveat:** agent-loop quality (tool calling, file edits, long autonomous runs) varies by model. Models that speak the Anthropic format natively (Claude, DeepSeek's Anthropic endpoint) tend to behave best; GPT/Gemini go through LiteLLM's format translation, which can occasionally change tool-call behavior.

### Model mapping matrix

What actually runs when you pick a model in Claude Code (`/model`), per active preset. The proxy matches the **tier keyword** in the model name — `opus` → opus tier, `haiku` → haiku tier, anything else (Sonnet, Fable, unknown) → sonnet tier:

| Your pick in Claude Code | Tier | preset `deepseek` | preset `claude` | preset `gpt` | preset `gemini` |
|---|---|---|---|---|---|
| Default / Opus (`claude-opus-4-8`) | opus | deepseek-v4-pro | claude-opus-4-8 | gpt-5.5 | gemini-3.5-flash |
| Fable (`claude-fable-5`) | sonnet | deepseek-v4-pro | claude-sonnet-4-6 | gpt-5.5 | gemini-3.5-flash |
| Sonnet (`claude-sonnet-4-6`) | sonnet | deepseek-v4-pro | claude-sonnet-4-6 | gpt-5.5 | gemini-3.5-flash |
| Haiku (`claude-haiku-4-5`) | haiku | deepseek-v4-pro | claude-haiku-4-5 | gpt-5-mini | gemini-2.5-flash |
| Subagents (usually haiku tier) | haiku | deepseek-v4-pro | claude-haiku-4-5 | gpt-5-mini | gemini-2.5-flash |

So on the `gpt` preset, picking Opus, Fable, or Sonnet in Claude Code all run `gpt-5.5`; only Haiku differs (`gpt-5-mini`). On single-model presets like `deepseek`, the picker choice makes no difference at all — control the model with presets (`/gpt`, `--switch`) instead. The picker only truly matters on presets whose three tiers point at different models (like `claude`).

### Model comparison matrix

Reference for the presets above (context/output limits as reported by a LiteLLM gateway's `/v1/models`; pricing is indicative list price — your gateway's billing may differ):

| Preset | Model (opus/sonnet tier) | Context | Max output | $/M in | $/M out | Agent loop | Notes |
|---|---|---|---|---|---|---|---|
| `deepseek` | deepseek/deepseek-v4-pro | 1M | 8k | ~$0.44 | ~$0.87 | ★★★★ | Cheapest; native Anthropic endpoint; small output cap |
| `claude` | claude-opus-4-8 | 1M | 128k | $5 | $25 | ★★★★★ | Strongest reasoning + tool use; most expensive |
| `claude` (sonnet tier) | claude-sonnet-4-6 | 1M | 64k | $3 | $15 | ★★★★★ | Best balance for routine agent work |
| `claude` (haiku tier) | claude-haiku-4-5 | 200k | 64k | $1 | $5 | ★★★★ | Fast subagent tier |
| `gpt` | gpt-5.5 | 1.05M | 128k | varies | varies | ★★★★ | Strong coding; via format translation |
| `gpt` (haiku tier) | gpt-5-mini | 272k | 128k | varies | varies | ★★★ | Cheap subagent tier |
| `gemini` | gemini/gemini-3.5-flash | 1.05M | 64k | varies | varies | ★★★ | Fast + cheap; tool-call quirks via translation |

Rules of thumb: `deepseek` for cheap everyday loops, `claude` when a task is hard or tool-heavy, `gpt`/`gemini` when those models fit your gateway's pricing better. Compare real latency on *your* gateway with `liteclaude --benchmark`, and real spend with `liteclaude --cost`.

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
