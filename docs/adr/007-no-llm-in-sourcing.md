# ADR-007: No LLM in the sourcing step

## Status
Accepted

## Context
The sourcing step collects raw signals from external APIs. An LLM could be used to decide what to search for, generate queries dynamically, or filter results during collection. However, the registry already contains explicit `search_terms`, `subreddits`, `competitors`, and `official_urls` for each surface.

## Decision
Sourcing is purely deterministic — it reads search parameters from the registry and fires API calls. No LLM is involved. The LLM's job starts in the structuring step, where it classifies and deduplicates the raw results.

## Consequences
- Sourcing is fast, cheap, and predictable — no LLM latency or token cost
- Search behavior is fully controlled by the registry, not by prompt wording
- Easy to debug — if a signal is missing, check the registry entries and API responses, not a prompt
- Limits flexibility — the system won't discover novel search angles on its own during sourcing
- This is an intentional tradeoff: we want the registry to be the single source of truth for what gets searched
