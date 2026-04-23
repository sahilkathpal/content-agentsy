# ADR-003: Multiple content opportunities per surface

## Status
Accepted

## Context
The original analysis agent produced one `ScoutOutput` per surface — a single friction/outcome/formats assessment. In practice, a surface like "mobile Claude Code access" yields signals about cost monitoring, tool comparison, Android workarounds, and surface parity — distinct content angles that shouldn't be collapsed into one.

## Decision
The analysis agent now clusters signals into multiple opportunities per surface. Each opportunity has its own:
- `opportunity_id`, `angle`, `friction`, `outcome`
- `meets_minimum_evidence` (1 pain + 1 demand + 1 freshness)
- `confidence_score` (1-5)
- `signal_ids` tracing back to supporting signals

The `ScoutOutput` schema wraps an `opportunities[]` array rather than holding a single opportunity at the top level.

## Consequences
- Richer output — one surface can yield 1-N content opportunities
- Each opportunity is independently scored and evidence-checked
- Signals can support multiple opportunities (shared `signal_ids`)
- The analysis prompt instructs Claude not to force multiple angles if only one exists
- Downstream layers (strategist, writer) can pick individual opportunities to act on
