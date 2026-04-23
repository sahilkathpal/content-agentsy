# ADR 011: Fetch Blog Index Once at Runner, Not Live Per Creator Call

## Status

Accepted

## Context

The creator agent needs to know what posts are already published on the Grass blog so it can cross-link to them naturally. Two approaches were considered:

1. **Live fetch per creator call** — `creator.ts` calls the Ghost Content API each time it runs
2. **Single fetch at runner startup** — the runner fetches the index once and passes it as a string to each `runCreator` call

## Decision

Fetch the blog index once in the runner, before the creator loop, and pass it as a parameter to `runCreator`.

## Reasons

- **Batch runs**: the runner processes multiple packets in a single session. A live fetch-per-call would hit the Ghost Content API N times for identical data.
- **Consistency with the existing pipeline pattern**: every other input to the creator (scout output, strategist output, Grass product context) is pre-resolved before the LLM call. A live network call inside `creator.ts` was the odd one out.
- **Reproducibility**: the blog index is part of the run's input. Fetching once means all packets in a run see the same snapshot, which makes run artifacts easier to reason about.
- **Freshness is good enough**: fetching at runner startup is effectively live for that run. The blog doesn't change mid-run.

## Consequences

- `runCreator` gains a `blogIndex?: string` parameter. Callers are responsible for providing it.
- If Ghost is unreachable, the runner logs a warning and passes an empty string; creator falls back to "(no existing posts yet)" and proceeds without cross-links.
- The `fetchBlogIndex()` utility in `src/sources/blog-index.ts` is a pure fetch function with no side effects — straightforward to test or call from future contexts (e.g., a future derivatives agent that also needs cross-link context).
