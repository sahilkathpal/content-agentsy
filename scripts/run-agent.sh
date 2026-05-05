#!/usr/bin/env bash
# run-agent.sh — Execute a single agent in a run directory.
#
# Usage:
#   ./scripts/run-agent.sh --agent <id> --run-dir <path> --stage <name> [--publish]
#
# To test an agent in isolation:
#   mkdir -p data/runs/test-run/research
#   echo '{}' > data/runs/test-run/research/input.json
#   ./scripts/run-agent.sh --agent researcher --run-dir data/runs/test-run --stage research

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load nvm if available (required in cron contexts with minimal PATH)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use

# ── Parse args ───────────────────────────────────────────────────────────────
AGENT_ID=""
RUN_DIR=""
STAGE=""
PUBLISH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)    AGENT_ID="$2"; shift 2 ;;
    --run-dir)  RUN_DIR="$2";  shift 2 ;;
    --stage)    STAGE="$2";    shift 2 ;;
    --publish)  PUBLISH=true;  shift 1 ;;
    *)          echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$AGENT_ID" || -z "$RUN_DIR" || -z "$STAGE" ]]; then
  echo "Usage: run-agent.sh --agent <id> --run-dir <path> --stage <name> [--publish]" >&2
  exit 1
fi

# Validate agent config exists
AGENT_CONFIG="$PROJECT_ROOT/content/pipelines/twitter-news/agents/$AGENT_ID/config.json"
if [[ ! -f "$AGENT_CONFIG" ]]; then
  echo "ERROR: Agent config not found: $AGENT_CONFIG" >&2
  exit 1
fi

# Ensure stage directory exists
mkdir -p "$RUN_DIR/$STAGE"

# ── Run ───────────────────────────────────────────────────────────────────────
cd "$PROJECT_ROOT"

export AGENT_ID="$AGENT_ID"
export AGENT_RUN_DIR="$RUN_DIR"
export AGENT_STAGE="$STAGE"
export AGENT_PUBLISH="$PUBLISH"

exec npx tsx src/run-agent.ts
