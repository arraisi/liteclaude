#!/usr/bin/env bash
# liteclaude installer
#
# Prompts for your LiteLLM base URL and API key, validates them against
# /v1/models, scans the available models to generate ~/.liteclaude.json,
# and links the `liteclaude` CLI.
#
# Non-interactive: set LITELLM_BASE_URL and LITELLM_API_KEY before running.
# The API key is never written to disk unless you opt in to the shell-rc step.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${HOME}/.liteclaude.json"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- prerequisites -----------------------------------------------------------
command -v curl >/dev/null || fail "curl is required"
command -v node >/dev/null || fail "Node.js >= 18 is required (https://nodejs.org)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js >= 18 required (found $(node --version))"
command -v claude >/dev/null || warn "Claude Code CLI not found on PATH — install it before running liteclaude"

# --- collect URL + API key ---------------------------------------------------
BASE_URL="${LITELLM_BASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  read -rp "LiteLLM base URL (e.g. https://litellm.example.com): " BASE_URL
fi
BASE_URL="${BASE_URL%/}"
[ -n "$BASE_URL" ] || fail "base URL is required"

API_KEY="${LITELLM_API_KEY:-}"
if [ -z "$API_KEY" ]; then
  read -rsp "LiteLLM API key (input hidden): " API_KEY
  printf '\n'
fi
[ -n "$API_KEY" ] || fail "API key is required"

# --- validate: scan /v1/models ----------------------------------------------
info "Validating gateway at ${BASE_URL} ..."
MODELS_JSON="$(curl -sf --max-time 15 "${BASE_URL}/v1/models" \
  -H "Authorization: Bearer ${API_KEY}")" \
  || fail "could not reach ${BASE_URL}/v1/models with that key (check URL and key)"

MODEL_COUNT="$(printf '%s' "$MODELS_JSON" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.length' 2>/dev/null)" \
  || fail "gateway responded, but not with a /v1/models payload"
info "Gateway OK — ${MODEL_COUNT} models available"

# --- generate config from scanned models -------------------------------------
if [ -f "$CONFIG_PATH" ]; then
  read -rp "${CONFIG_PATH} exists — overwrite with generated presets? [y/N] " OVERWRITE
  case "$OVERWRITE" in
    y|Y) printf '%s' "$MODELS_JSON" | node "${REPO_DIR}/scripts/generate-config.js" "$BASE_URL" ;;
    *)   info "Keeping existing config" ;;
  esac
else
  printf '%s' "$MODELS_JSON" | node "${REPO_DIR}/scripts/generate-config.js" "$BASE_URL"
fi

# --- offer to persist the key in the shell rc --------------------------------
if [ -z "${LITELLM_API_KEY:-}" ]; then
  case "${SHELL:-}" in
    */zsh)  RC_FILE="${HOME}/.zshrc" ;;
    */bash) RC_FILE="${HOME}/.bashrc" ;;
    *)      RC_FILE="" ;;
  esac
  if [ -n "$RC_FILE" ]; then
    read -rp "Append 'export LITELLM_API_KEY=…' to ${RC_FILE}? [y/N] " SAVE_KEY
    case "$SAVE_KEY" in
      y|Y)
        printf '\nexport LITELLM_API_KEY="%s"\n' "$API_KEY" >> "$RC_FILE"
        info "Key saved to ${RC_FILE} — restart your shell or: source ${RC_FILE}"
        ;;
      *)
        info "Key NOT saved. Export it yourself before running liteclaude:"
        printf '    export LITELLM_API_KEY="<your key>"\n'
        ;;
    esac
  fi
fi

# --- link the CLI -------------------------------------------------------------
info "Linking liteclaude CLI ..."
chmod +x "${REPO_DIR}/bin/liteclaude.js"
if npm link --prefix "$REPO_DIR" >/dev/null 2>&1 || (cd "$REPO_DIR" && npm link >/dev/null 2>&1); then
  info "Linked via npm link"
elif [ -w /usr/local/bin ]; then
  ln -sf "${REPO_DIR}/bin/liteclaude.js" /usr/local/bin/liteclaude
  info "Symlinked to /usr/local/bin/liteclaude"
else
  warn "Could not link automatically. Run: sudo ln -s ${REPO_DIR}/bin/liteclaude.js /usr/local/bin/liteclaude"
fi

printf '\n'
info "Done. Next steps:"
printf '    liteclaude --status              # verify setup\n'
printf '    liteclaude --install-commands    # /preset slash commands inside Claude Code\n'
printf '    liteclaude                       # launch Claude Code through the proxy\n'
