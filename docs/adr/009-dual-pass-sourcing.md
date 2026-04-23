# ADR-009: Dual-pass sourcing (new + hot)

## Status
Accepted

## Context
The original sourcing step ran a single pass per search term: Reddit search sorted by `new` over the past month, and HN search sorted by date over 30 days. This consistently returned the same posts across runs and missed older posts that had gained significant new engagement (upvotes, comments) since they were first posted.

With cross-run freshness tagging (ADR-008), we can now detect when a post resurfaces. But resurfacing only works if the pipeline actually fetches posts with updated scores — the old single-pass approach didn't do this for posts outside the recent time window.

## Decision
Community pain collection now runs two passes in parallel:

- **Pass 1 (new):** Reddit search `sort=new, time=day, limit=10` + HN search `daysBack=2` sorted by date. Catches posts from the last 1-2 days.
- **Pass 2 (hot):** Reddit hot listing `limit=10` per subreddit + HN search `daysBack=7` sorted by relevance/points. Catches older posts with current momentum.

Overlap between passes is handled by the existing within-run URL deduplication in the structuring step.

## Consequences
- Fresh posts and trending posts are both captured, feeding the freshness classifier with richer data
- Raw result volume roughly doubles for community_pain, but structuring already caps at 30 results and deduplicates by URL
- The hot listing endpoint (`/r/{sub}/hot.json`) is not query-filtered — it returns whatever Reddit considers hot, which may include irrelevant posts. The structuring LLM handles relevance filtering.
- HN's `search` endpoint (relevance sort) returns higher-engagement posts that `search_by_date` misses, at the cost of potentially older results — acceptable since we're explicitly looking for momentum
- Consistent with ADR-007: sourcing remains deterministic, no LLM involvement in what gets fetched
