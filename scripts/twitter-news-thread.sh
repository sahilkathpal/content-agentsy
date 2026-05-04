#!/usr/bin/env bash
# twitter-news-thread.sh — Orchestrate the daily Twitter news thread workflow.
#
# Stages: research → edit → write → visuals → publish (optional)
#
# Usage:
#   ./scripts/twitter-news-thread.sh [options]
#
# Options:
#   --publish           Run the publisher stage (post to Typefully)
#   --skip-visuals      Skip visuals scout, pass write output directly to qa
#   --from <stage>      Re-run from this stage (overrides cached state)
#   --until <stage>     Stop after this stage (useful for partial runs/testing)
#   --run-dir <path>    Use a specific run directory (default: data/runs/twitter-news-thread-DATE)
#   --date <YYYY-MM-DD> Override the date (default: today)
#
# Examples:
#   # Preview editorial decision before writing
#   ./scripts/twitter-news-thread.sh --until edit
#
#   # Resume a failed write stage
#   ./scripts/twitter-news-thread.sh --from write --run-dir data/runs/twitter-news-thread-2026-05-04
#
#   # Full run with publish
#   ./scripts/twitter-news-thread.sh --publish

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNS_DIR="$PROJECT_ROOT/data/runs"
WORKFLOW="twitter-news-thread"

# ── Parse args ───────────────────────────────────────────────────────────────
PUBLISH=false
SKIP_VISUALS=false
FROM_STAGE=""
UNTIL_STAGE=""
RUN_DIR=""
DATE="$(date +%Y-%m-%d)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)       PUBLISH=true;          shift 1 ;;
    --skip-visuals)  SKIP_VISUALS=true;     shift 1 ;;
    --from)          FROM_STAGE="$2";       shift 2 ;;
    --until)         UNTIL_STAGE="$2";      shift 2 ;;
    --run-dir)       RUN_DIR="$2";          shift 2 ;;
    --date)          DATE="$2";             shift 2 ;;
    --help|-h)       sed -n '2,30p' "$0" | grep '^#' | sed 's/^# \?//'; exit 0 ;;
    *)               echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$RUN_DIR" ]]; then
  RUN_DIR="$RUNS_DIR/${WORKFLOW}-${DATE}"
fi
mkdir -p "$RUN_DIR"

STATE_FILE="$RUN_DIR/state.json"
STAGES=("research" "edit" "write" "visuals" "publish")

# ── State helpers ─────────────────────────────────────────────────────────────

state_init() {
  if [[ ! -f "$STATE_FILE" ]]; then
    cat > "$STATE_FILE" <<EOF
{
  "workflow": "${WORKFLOW}",
  "run_id": "$(basename "$RUN_DIR")",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "stages": {}
}
EOF
  fi
}

stage_status() {
  local stage="$1"
  if [[ ! -f "$STATE_FILE" ]]; then echo "pending"; return; fi
  jq -r --arg s "$stage" '.stages[$s].status // "pending"' "$STATE_FILE" 2>/dev/null || echo "pending"
}

mark_stage() {
  local stage="$1" status="$2"
  local tmp
  tmp="$(mktemp)"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq --arg s "$stage" --arg st "$status" --arg ts "$ts" \
    '.stages[$s] = { "status": $st, "updated_at": $ts }' \
    "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# ── Stage execution ───────────────────────────────────────────────────────────

# Returns 0 if stage should run, 1 if it should be skipped
should_run() {
  local stage="$1"

  # If --from is set, skip stages before it
  if [[ -n "$FROM_STAGE" ]]; then
    local found_from=false
    for s in "${STAGES[@]}"; do
      if [[ "$s" == "$FROM_STAGE" ]]; then found_from=true; fi
      if [[ "$s" == "$stage" ]]; then break; fi
    done
    # Stage comes before FROM_STAGE — skip it
    if [[ "$found_from" == false ]]; then return 1; fi
  fi

  # Skip if already done (unless this is exactly the --from stage)
  local status
  status="$(stage_status "$stage")"
  if [[ "$status" == "done" && "$stage" != "$FROM_STAGE" ]]; then
    return 1
  fi

  return 0
}

run_stage() {
  local stage="$1"
  local agent="$2"
  shift 2
  local extra_args=("$@")

  if ! should_run "$stage"; then
    local status
    status="$(stage_status "$stage")"
    echo ""
    echo "--- ${stage} (${status:-cached}, skipping) ---"
    return 0
  fi

  echo ""
  echo "--- ${stage} ---"
  mkdir -p "$RUN_DIR/$stage"
  mark_stage "$stage" "running"

  local log_file="$RUN_DIR/$stage/agent.log"

  set +e
  "$SCRIPT_DIR/run-agent.sh" \
    --agent "$agent" \
    --run-dir "$RUN_DIR" \
    --stage "$stage" \
    "${extra_args[@]}" \
    2>&1 | tee "$log_file"
  local exit_code="${PIPESTATUS[0]}"
  set -e

  if [[ $exit_code -ne 0 ]]; then
    mark_stage "$stage" "failed"
    echo ""
    echo "ERROR: ${stage} failed (exit ${exit_code})" >&2
    echo "Log: ${log_file}" >&2
    exit 1
  fi

  mark_stage "$stage" "done"

  # Stop here if --until reached
  if [[ -n "$UNTIL_STAGE" && "$stage" == "$UNTIL_STAGE" ]]; then
    echo ""
    echo "Stopping after --until ${UNTIL_STAGE}"
    echo "Run dir: ${RUN_DIR}"
    exit 0
  fi
}

# ── Main sequence ─────────────────────────────────────────────────────────────

state_init

echo "======================================================================"
echo "Twitter News Thread — ${DATE}"
echo "Run dir: ${RUN_DIR}"
[[ -n "$FROM_STAGE" ]]  && echo "Resuming from: ${FROM_STAGE}"
[[ -n "$UNTIL_STAGE" ]] && echo "Stopping after: ${UNTIL_STAGE}"
echo "======================================================================"

# Stage 1: Research
mkdir -p "$RUN_DIR/research"
echo '{}' > "$RUN_DIR/research/input.json"
run_stage "research" "researcher"

# Stage 2: Edit
run_stage "edit" "editor"

# Stage 3: Write
run_stage "write" "x-writer"

# Stage 4: Visuals
if [[ "$SKIP_VISUALS" == "true" ]]; then
  if ! should_run "visuals"; then
    echo ""
    echo "--- visuals (cached, skipping) ---"
  else
    echo ""
    echo "--- visuals (skipped via --skip-visuals) ---"
    mkdir -p "$RUN_DIR/visuals" "$RUN_DIR/publish"
    # Pass write output directly to downstream stages
    cp "$RUN_DIR/write/output.json" "$RUN_DIR/visuals/output.json"
    cp "$RUN_DIR/write/output.json" "$RUN_DIR/publish/input.json"
    mark_stage "visuals" "done"
  fi
else
  run_stage "visuals" "visuals-scout"
fi

# Stage 5: Publish (conditional)
if [[ "$PUBLISH" == "true" ]]; then
  run_stage "publish" "publisher" --publish
else
  echo ""
  echo "(Skipping publish — run with --publish to post to Typefully)"
fi

echo ""
echo "======================================================================"
echo "Done → ${RUN_DIR}"
echo "======================================================================"
