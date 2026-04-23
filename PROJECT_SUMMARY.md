# content-agentsy — Project Summary

> Last updated: 2026-04-21

## What It Is

**content-agentsy** is an automated content factory built for the [Grass](https://codeongrass.com) brand. It scouts content signals from the web, ranks opportunities, generates GEO-optimized canonical blog posts, creates derivative social assets, and publishes them — all in a single orchestrated pipeline.

Built by Sahil Kathpal (co-maker of Grass, alongside Anil Dukkipatty, Raunaq Vaisoha, and Sunny).

---

## Core Architecture: 6-Layer Pipeline

The system is modelled after the **Content Factory Framework** (`content-factory-final-framework.pdf`) and runs as a sequential, file-based pipeline with each layer writing JSON output to `data/runs/<timestamp>/`.

| # | Layer | Agent / Module | Output |
|---|-------|---------------|--------|
| 1 | **Scout → Sourcing** | `sourcing.ts` | `raw-buckets.json` |
| 2 | **Scout → Structuring** | `structuring.ts` | `signals.json` |
| 3 | **Scout → Analysis** | `analysis.ts` | `scout-output.json` |
| 4 | **Strategist** | `strategist.ts` | `strategist-output.json` |
| 5 | **Creator** | `creator.ts` | `creator-output.json` |
| 6 | **Derivatives** | `derivatives.ts` | `derivatives-output.json` |
| 7 | **Publisher** | `publisher.ts` + `syndication-publisher.ts` | `publisher-output.json`, `syndication-publisher-output.json` |
| 8 | **Scorer** | `scorer.ts` | `scorecards.json` |
| 9 | **Analyst** | `analyst.ts` | `analyst-output.json` |

---

## Signal Sources

The pipeline ingests signals from multiple sources:

- **Reddit** (`reddit.ts`) — trending discussions in relevant subreddits
- **Hacker News** (`hackernews.ts`) — top posts and comments
- **GSC** (`gsc.ts`) — Google Search Console keyword/query data
- **Otterly** (`otterly.ts`) — AI citation tracking (keyed to `codeongrass.com`)
- **Blog Index** (`blog-index.ts`) — existing Grass posts (for deduplication and cross-linking)
- **Authority Search** (`authority-search.ts`) — authoritative external sources via Parallel Web

---

## Surface Registry

Surfaces are defined in `surfaces.json` and registered via `src/registry/`. Each surface has:
- `id` — unique identifier
- `tier` — priority tier (1 = highest)
- `type` — `permanent` or `rotating`

The runner selects surfaces with `--surface`, `--type`, or `--max-tier` flags.

---

## Content Object Framework

Each content opportunity is mapped to three key dimensions (from the framework PDF):

| Dimension | Values | Meaning |
|-----------|--------|---------|
| **Intent Mode** | `M0_RESOLVE`, `M1_EVALUATE`, `M2_EXECUTE` | Reader's state of mind |
| **Grass Role** (`grass_role`) | `light`, `evaluate`, `integrate`, `execute` | Brand presence in the content |
| **Format** | e.g., `how-to`, `comparison`, `tutorial` | Content shape |

- **light** — Grass absent or incidental; pure topical authority
- **evaluate** — Grass present but not dominant; one option among many
- **integrate** — Technique is the hero, Grass is the best operational layer; core content is tool-agnostic with a dedicated Grass section
- **execute** — Grass IS the subject; tutorial/guide specifically about using Grass

These map directly to creator prompts in `src/prompts/creator.md`.

---

## Key Concepts

### Distribution Packets
The **Strategist** assembles ranked "distribution packets" — bundles of (surface, format, intent mode, channel, angle) scored by `composite_score`. The creator processes the top-N packets.

### GEO Optimization
Posts are optimized for Generative Engine Optimization — structured to be cited by AI search engines. Otterly monitors citations against `codeongrass.com`.

### Ledger
A cross-run URL ledger (`ledger.ts`) tags signals as fresh or previously seen, preventing duplicate content opportunities.

### Asset Manifest
After publishing, a `manifest.json` is built per packet tracking all asset IDs, channels, and publish URLs for downstream scoring.

---

## Publishing Targets

| Target | Agent | Format |
|--------|-------|--------|
| **Ghost blog** (codeongrass.com) | `publisher.ts` | HTML wrapped in Lexical JSON envelope (Ghost 5+) |
| **Dev.to** | `syndication-publisher.ts` | Markdown |
| **Hashnode** | `syndication-publisher.ts` | Markdown |

> **Note:** Ghost 5+ requires HTML posted as `lexical` field (not raw `html`). See `feedback_ghost_lexical.md`.

---

## Running the Pipeline

```bash
# Full pipeline (scout → strategist → creator → publish)
npm start -- --type permanent --strategist --creator --publisher

# Partial runs
npm start -- --strategist-only
npm start -- --creator-only
npm start -- --derivatives-only
npm start -- --publisher-only
npm start -- --syndicate-only
npm start -- --scorer-only
npm start -- --analyst-only

# Control scope
npm start -- --surface <surface-id>
npm start -- --max-tier 2
npm start -- --top-n 3
npm start -- --packet <packet-id>
npm start -- --channel blog
npm start -- --concurrency 5
```

---

## Tech Stack

- **Runtime:** Node.js with TypeScript (`tsx`)
- **AI / LLM:** Claude API (`src/claude.ts`)
- **Web search:** Parallel Web (`parallel-web`)
- **Markdown rendering:** `marked`
- **Validation:** `zod`
- **Output format:** JSON per layer, Markdown previews for derivatives

---

## Key Files

```
src/
  runner.ts                  # CLI entrypoint & pipeline orchestrator
  claude.ts                  # Claude API client
  config.ts                  # Environment config
  ledger.ts                  # Cross-run URL freshness tracking
  manifest.ts                # Asset manifest builder
  agents/                    # Pipeline stage agents
  models/                    # Zod output schemas per stage
  prompts/                   # LLM prompt markdown files
  sources/                   # Signal source integrations
  registry/                  # Surface registry loader
surfaces.json                # Surface definitions
config.json                  # App config
data/runs/                   # Per-run output directory
```

---

## Open TODOs

- **Authority link scoring** — `authority-search.ts` returns links in Parallel's default order; needs domain-tier scoring or relevance ranking (see `project_authority_ranking.md`)
