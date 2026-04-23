# ADR 012: Authority Links via Parallel Search Before Creator

## Status

Accepted

## Context

The creator agent links internally (cross-links to Grass blog posts) and cites community proof assets (Reddit/HN quotes), but does not link to external high-authority sources (official docs, specs, research). Adding these links improves LLM citability through source graph signals, claim verifiability, and topical co-occurrence with canonical sources.

Three approaches were considered:

1. **Prompt-only** — ask the LLM to find and link authoritative sources itself
2. **Post-creation injection** — bolt links onto the finished post
3. **Pre-creation search** — find real URLs before the creator runs and pass them as context

## Decision

Use Parallel Web's `beta.search()` to find authoritative external sources before the creator runs, then pass them as template context. The creator weaves them naturally during writing.

## Reasons

- **LLMs hallucinate URLs.** Prompt-only approaches produce plausible but broken links. Pre-searched URLs are real and verified by Parallel.
- **Natural integration.** Links woven during writing read naturally; bolted-on links don't. The creator sees the links alongside the topic context and can place them where they genuinely support claims.
- **Parallel is already in the stack.** `src/sources/parallel-extract.ts` already uses the same client pattern. No new dependency.
- **Consistent with ADR 011 pattern.** Like blog index, authority links are fetched once at the runner level and passed as a parameter — pre-resolved before the LLM call.

## Implementation

- New `src/sources/authority-search.ts` wraps `beta.search()` with `exclude_domains` for social media, forums, and our own domain.
- `src/prompts/creator.md` gains a `{{authority_links}}` section with rules for inline linking.
- `src/agents/creator.ts` gains an `authorityLinks?: string` parameter.
- `src/runner.ts` calls `searchAuthorityLinks()` before `runCreator()` at both call sites and writes `authority-links.json` for auditability.

## Consequences

- Each creator invocation adds one Parallel `beta.search()` call (~1-3s latency). Acceptable for the current batch-run pattern.
- No authority ranking on our side — we trust Parallel's relevance ordering. This is a known gap to revisit later (domain-tier scoring, primary-source boosting).
- `external_links_used` is an optional field on creator output, so existing outputs remain valid.
- If Parallel is unreachable, the search returns an empty array and the creator proceeds without authority links (graceful degradation).
