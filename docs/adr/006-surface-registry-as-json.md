# ADR-006: Surface registry as a static JSON file with Zod validation

## Status
Accepted

## Context
The system needs a registry of content surfaces, subreddits, and competitors. This data changes infrequently (manual edits) and drives what the sourcing agent searches for. Options included a database, a Notion table, or a plain JSON file.

## Decision
The registry lives in `surfaces.json` at the project root. It's loaded and validated at startup using Zod schemas defined in `src/models/surface.ts`. The registry code provides helper functions to select surfaces by tier/type and look up related subreddits and competitors.

Each surface has: `id`, `label`, `type` (permanent|rotating), `tier` (1-3), `search_terms[]`, and optional `official_urls[]`.

## Consequences
- Human-readable and editable — no database setup, no external service dependency
- Git history serves as the version record for registry changes
- Zod validation catches schema errors at startup rather than at query time
- No query language — filtering is simple array operations, which is sufficient at current scale
- If the registry grows significantly, we may need to revisit (but unlikely for content surfaces)
