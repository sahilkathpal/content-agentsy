# ADR-001: Three-step pipeline with disk-persisted intermediates

## Status
Accepted

## Context
The scout layer needs to collect raw signals from external APIs and then use an LLM to structure and analyze them. The original design combined sourcing and structuring into a single step, but this caused practical problems (large payloads failing on stdin pipes) and design problems (no way to inspect raw data before LLM processing, no way to re-analyze without re-sourcing).

## Decision
Split the pipeline into three sequential steps per surface, each writing its output to disk before the next step reads it:

1. **Sourcing** — parallel API calls (Reddit, HN, Parallel Extract, Frase) → `raw-buckets.json`
2. **Structuring** — LLM call to classify/deduplicate/structure raw results → `signals.json`
3. **Analysis** — LLM call to cluster signals into content opportunities → `scout-output.json`

## Consequences
- Each step has an inspectable artifact on disk
- Prompts can be iterated without re-sourcing (just re-run structuring or analysis against existing files)
- Sourcing failures don't waste LLM calls
- LLM steps read from disk rather than receiving large payloads in-memory, avoiding pipe buffer issues
- Slightly more disk I/O, but negligible given JSON file sizes
