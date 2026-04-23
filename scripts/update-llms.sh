#!/usr/bin/env bash
set -euo pipefail

# Load nvm if available (needed for cron which has minimal PATH)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.."
LOG_DIR="data/logs"
mkdir -p "$LOG_DIR"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) update-llms starting ==="
npx tsx src/scripts/update-llms.ts
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) update-llms done ==="
