# ADR 010: Split Measurement into Scorer + Analyst Layers

## Status

Accepted

## Context

The original framework combined measurement and analysis into a single "Measurement and Learning Layer" (Layer 5). In practice, collecting raw performance data (mechanical) and interpreting patterns (judgmental) are distinct responsibilities that run on different cadences and have different failure modes.

## Decision

Split the old Layer 5 into two layers:

| Layer | Name | Job | Cadence |
|-------|------|-----|---------|
| 5 | Scorer | Collect raw performance data → Scorecards | Daily/weekly |
| 6 | Analyst | Interpret patterns → Strategy memory updates | Weekly/monthly |

This changes the factory from 6 layers to 7.

### Scorer (Layer 5)

- Mechanical, automated, no judgment
- Sources: Google Search Console (SEO), Otterly (GEO citations), Frase (GEO share of voice)
- Output: one scorecard per asset, rollable-up to packet level via `packet_id`

### Analyst (Layer 6)

- Pattern recognition across multiple scorecards
- Computes: surface hit rate, mode performance, format performance, GEO compounding, SEO trajectory
- Writes back into: surface registry, packet heuristics, proof preferences, channel rules

### Scorecard Schema

The scorecard is the bridge between the two layers. Identity fields (surface_id, mode, format, voice_type, channel, asset_type) enable all cross-cutting analysis queries the Analyst needs.

### Deferred Sources

Content-level metrics (Plausible/PostHog) and social distribution metrics (Buffer/Reddit) will be added once those integrations are live.

## Consequences

- Scorer can run frequently without Claude costs when API integrations replace the LLM merge step
- Analyst failures don't block scorecard generation
- Scorecards become the single source of truth for asset performance data
- Runner gains `--scorer-only` and `--analyst-only` flags for independent execution
