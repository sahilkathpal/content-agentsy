#!/usr/bin/env bash
set -euo pipefail

# Load nvm if available (needed for cron which has minimal PATH)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.."
LOG_DIR="data/logs"
mkdir -p "$LOG_DIR"
LOGFILE="$LOG_DIR/$(date +%Y-%m-%dT%H-%M-%S).log"
npm start -- --publisher --top-n 3 2>&1 | tee "$LOGFILE"
