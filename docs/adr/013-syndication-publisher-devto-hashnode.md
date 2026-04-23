# ADR 013: Syndication Publisher for Dev.to and Hashnode

## Status

Accepted

## Context

The derivatives agent generates reformatted markdown for syndication platforms (Dev.to, Hashnode, HackerNoon, Medium), but nothing publishes them. HackerNoon and Medium lack programmatic publishing APIs. Dev.to (Forem REST API) and Hashnode (GraphQL API) both support draft creation — so we add a pure-API agent that reads derivatives output and posts drafts to those two platforms.

Two decisions were required:

1. **LLM or no LLM?** The content is already formatted per-platform by the derivatives agent. Publishing is mechanical — read markdown, call API, record result.
2. **Hashnode `publishPost` or `createDraft`?** `publishPost` goes live immediately. `createDraft` creates a draft for human review.

## Decision

Build a no-LLM syndication publisher agent that posts derivatives as drafts to Dev.to and Hashnode. Use Hashnode's `createDraft` mutation instead of `publishPost`.

## Reasons

- **No LLM needed.** The derivatives agent already tailors content per platform. The publisher is a thin API adapter — adding an LLM call would add cost and latency for zero value.
- **Drafts match existing pattern.** Ghost publisher creates drafts. Dev.to supports `published: false`. Hashnode's `createDraft` gives the same review step. Everything starts as a draft for human review before going live.
- **Graceful degradation per platform.** Missing API keys skip that platform with a log message rather than failing the pipeline. Each platform is independent — a Dev.to failure doesn't block Hashnode.
- **Canonical URL backlinks built in.** Both APIs accept a canonical URL field (`canonical_url` for Dev.to, `originalArticleURL` for Hashnode), preserving SEO attribution to the Grass blog post.

## Implementation

- New `src/agents/syndication-publisher.ts` — reads `derivatives-output.json`, finds assets matching `dev.to` / `hashnode`, calls respective APIs.
- New `src/models/syndication-publisher-output.ts` — Zod schema for per-platform results (status, remote_id, remote_url, error).
- `src/config.ts` gains `DEVTO_API_KEY`, `HASHNODE_PAT`, `HASHNODE_PUBLICATION_ID`.
- `src/runner.ts` gains `--syndicate` (cascading) and `--syndicate-only` flags. Syndication runs after derivatives, before Ghost publisher.

## Consequences

- HackerNoon and Medium remain manual until those platforms offer publishing APIs.
- Hashnode drafts have no public URL until published — `remote_url` is null for Hashnode results.
- `--publisher` now cascades through syndication (`syndicate=true`), so the full pipeline is: scout → strategist → creator → derivatives → syndication-publisher → ghost-publisher.
- Platform matching uses fuzzy string checks on `asset.platform` (lowercased). If the derivatives agent changes platform naming, the matching logic may need updating.
