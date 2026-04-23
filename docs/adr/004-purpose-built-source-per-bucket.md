# ADR-004: Purpose-built source client per signal bucket

## Status
Accepted

## Context
We need signals across four buckets: community pain, official changes, demand, and market framing. A generic web search API could serve all four, but each bucket has a better purpose-built source.

## Decision
Each bucket uses a dedicated source client:

| Bucket | Source | Why |
|--------|--------|-----|
| Community pain | Reddit JSON API + HN Algolia API | Subreddit-scoped search gives targeted pain signals; HN gives tech community signal. Both are free, no auth. |
| Official changes | Parallel Extract | Pulls structured content from specific vendor doc/changelog URLs defined in the registry. |
| Demand | Frase API | SERP analysis, related queries, and People Also Ask data for surface search terms. |
| Market framing | Parallel Extract | Extracts content from competitor watched URLs defined in the registry. |

All four fire in parallel via `Promise.allSettled`.

## Consequences
- Higher signal quality per bucket than generic search
- Each source can fail independently without blocking others (`Promise.allSettled`)
- Requires `PARALLEL_API_KEY` and `FRASE_API_KEY` for those buckets; Reddit and HN need no keys
- Adding a new source means adding a new client in `src/sources/` — no changes to existing ones
