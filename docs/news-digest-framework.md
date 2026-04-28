# News Digest Framework

Multi-agent pipeline that produces a daily AI coding news digest — an X thread with visuals, a companion blog post, and a Typefully draft — fully automated from source collection to publication.

## Pipeline Overview

```
Research → Edit → Write → Visuals + Companion → QA → Publish
  27s       133s   87s         ~800s              95s    7s
```

Orchestrated by `src/workflows/daily-news.ts` with checkpoint/resume support. Each stage writes its output to `data/runs/digest-{date}/` and marks itself done in `digest-state.json`, so a crashed run can resume from the last completed stage.

**Entry point:** `npx tsx src/runner.ts --digest [--publisher] [--skip-visuals] [--digest-resume DATE]`

---

## Agents

### 1. Researcher (`src/agents/news-researcher.ts`)

Collects raw news from 8 event-driven sources in parallel, then deduplicates.

**Sources (4-tier system):**

| Tier | Source | Function | Signal |
|------|--------|----------|--------|
| T1 | GitHub Releases | `fetchRecentReleases()` | New versions from watchlist repos (last 2 days) |
| T1 | Official RSS | `fetchOfficialFeeds()` | Anthropic, OpenAI, Cursor, GitHub, Google DeepMind, HF, AWS, Sourcegraph blogs |
| T2 | Hacker News | `fetchHNFrontPage()` | Front page stories, min 30 pts, filtered by watchlist relevance |
| T2 | X Viral | `searchXViral()` | Viral posts about coding agents, min 100-200 faves |
| T3 | GitHub Velocity | `detectVelocitySpikes()` | Repos gaining 100+ stars or 5%+ growth in 24h |
| T3 | GitHub Trending | `searchGitHubTrending()` | New repos (<30d, 10+ stars) + active repos (500+ stars, pushed recently) |
| T3 | Curated RSS | `fetchCuratedFeeds()` | Simon Willison, Latent Space, HF Daily Papers |
| T4 | Reddit | `searchSubreddit()` | Hot posts from ClaudeAI, LocalLLaMA, ExperiencedDevs, cursor |

**Deduplication:**
- Normalizes URLs (strips protocol, www, query params, collapses github.com/org/repo variants)
- Higher tier wins when duplicates found
- Ledger filter removes URLs already published in prior runs (`data/seen-urls.json`)

**Output:** `NewsItem[]` — raw items with tier, event_type, score, source metadata.

**Tools used:** `src/tools/rss.ts`, `src/tools/x-search.ts`, `src/sources/hackernews.ts`, `src/sources/github-trending.ts`, `src/sources/github-releases.ts`, `src/sources/github-snapshots.ts`

---

### 2. Editor (`src/agents/news-editor.ts`)

Three-phase curation pipeline that takes 100+ raw items down to 8-10 publishable stories.

**Phase 1 — Hard-drop (code-based):**
- Rejects stale items (>72h old)
- Rejects meta/non-news patterns (weekly discussions, job posts, course enrollments, awesome lists — 12 regex patterns)
- Rejects old repos with no news event backing them

**Phase 1b — Clustering:**
- Groups by normalized URL
- Merges by title similarity (bigram Dice coefficient > 0.4)
- Each cluster picks a primary item by: lowest tier, then highest score

**Phase 1c — Enrichment:**
Each cluster gets metadata: age (hours), source breadth (distinct source types), tier best, event type, engagement level (none/low/moderate/high), official source flag, community validation flag.

**Phase 1d — Pre-sort & cap:**
- Sort by: source breadth DESC → tier ASC → engagement DESC → age ASC
- Cap at 40 clusters for LLM input

**Phase 2 — LLM editorial judgment (Claude Sonnet):**
Each cluster gets rated: `must_tell`, `solid`, `filler`, or `skip`. Included stories get a lead angle, category (launch/update/research/drama/tutorial/benchmark/opinion), and reasoning.

**Phase 3 — Post-processing (code-based):**
- Keep only `include: true` stories
- Rank by: must_tell > solid > filler, then source breadth, then tier
- Diversity enforcement: if any source type >50%, demote excess
- Hard cap at 10 stories

**Output:** `EditorialDecision` — date, publishable flag, ranked `CuratedStory[]` with significance (high/medium), one-liner angles, and categories.

**Tools used:** Claude Sonnet via `src/claude.ts`, prompt from `src/prompts/news-editor.md`

---

### 3. Writer (`src/agents/news-writer.ts`)

Two-pass content generation: X thread first, then companion blog post.

**Pass 1 — Thread generation:**
- Selects a voice skill based on story count:

| Stories | Format | Skill file |
|---------|--------|------------|
| 8+ | full_digest | `src/skills/thread-writer.md` |
| 4-7 | standard_thread | `src/skills/thread-writer-standard.md` |
| 2-3 | short_thread | `src/skills/thread-writer-short.md` |
| 1 | single_story | `src/skills/thread-writer-single.md` |

- Loads `src/prompts/news-writer-thread.md` with date, stories JSON, format, skill name, and Grass brand context
- Claude generates an `XThread`: hook + `ThreadSegment[]` + CTA
- Each segment can include a `visual_hint` (description, image_type, product_name, candidate_urls) for the visuals scout

**Pass 2 — Companion post:**
- Loads `src/prompts/news-writer-companion.md` with thread segments and stories
- Generates a `CompanionPost` (title + markdown body with source links) for Ghost blog

**Post-generation:** 280-char enforcement loop — any over-limit segments get trimmed by Claude until all pass.

**Output:** `DigestContent` — date, x_thread, companion_post.

**Tools used:** Claude via `src/claude.ts`, prompts from `src/prompts/news-writer-thread.md` and `src/prompts/news-writer-companion.md`

---

### 4. Visuals Scout (`src/agents/visuals-scout.ts`)

Resolves `visual_hint` directives in thread segments to actual downloadable media files.

**Architecture:** Spawns a Claude subprocess with Bash + Read tools. The subprocess autonomously browses, downloads, screenshots, and selects the best visual for each segment — adapting strategy based on what it finds.

**CLI tools available to the subprocess:**

| Command | Tool | Purpose |
|---------|------|---------|
| `npx tsx src/tools/cli/browse-url.ts <url> <hint-json>` | Parallel API | Browse a URL and find visual candidates matching the hint |
| `npx tsx src/tools/cli/download-image.ts <image-url> <output-path>` | fetch + sharp | Download an image with content-type/size validation |
| `npx tsx src/tools/cli/capture-visual.ts <url> <output-path> [--selector SEL] [--scroll-to SEL]` | Playwright | Take a screenshot of a page or specific element |

**Visual resolution flow:**
1. Filter segments that have visual_hint + candidate_urls
2. Load `src/prompts/visuals-scout.md` with segments JSON and media output directory
3. Subprocess browses candidate URLs, finds images, downloads or screenshots them
4. Each resolved visual gets post-processed by `ensureUploadable()` (resize to X limits: max 5MB, max 1600px)
5. Results written to `data/runs/digest-{date}/media/seg-{n}.{ext}`

**Image validation (`src/tools/image-download.ts`):**
- Content-Type must be image/png, jpeg, gif, or webp
- Size must be >100 bytes (rejects tracking pixels)
- SVG detection by header AND content scan

**Image processing (`src/tools/image-process.ts`):**
- Max 1600px longest edge (resize with sharp)
- Max 5MB for static images, 15MB for GIFs
- Re-encodes as JPEG quality=90 if still too large after resize

**Screenshot capture (`src/tools/playwright-screenshot.ts`):**
- Headless Chromium at 1280x800 @2x DPR
- Forces light color scheme
- Dismisses cookie/consent popups (12 selector variants)
- Hides fixed/sticky elements before capture
- Element capture if selector provided and element is 600px+ wide

**Output:** `DigestContent` mutated with `media` fields populated on segments.

---

### 5. QA Reviewer (`src/agents/news-qa.ts`)

Soft editorial gate — scores the thread but does not block publishing.

**Phase 1 — Deterministic code checks:**

| Check | Rule |
|-------|------|
| Length | Each segment <= 280 chars |
| Segment count | Must fit format range (full: 8-15, standard: 6-10, short: 5-8, single: 4-6) |
| Hook quality | No "So", "Now" openers; no "Thread" or thread emoji |
| Banned words | Flags: "game-changer", "revolutionary", "groundbreaking" |
| Fire emoji cap | Max 2 per thread |
| CTA structure | Last segment should not be a story post |
| Engagement mechanics | Must have enough curiosity gaps, pattern interrupts, social proof, contrarian framing, reply bait, bookmark triggers |

**Phase 2 — LLM review (Claude Haiku):**
- Loads `src/prompts/news-qa.md` with format, thread segments, and stories
- Scores 0-5 (3 is neutral)
- Returns suggestions and position-specific segment notes

**Output:** `QaResult` — code_issues[], llm_review (score, suggestions, segment_notes).

---

### 6. Publisher (`src/agents/native-publisher.ts` + `src/tools/typefully.ts`)

Creates a Typefully draft with media uploads.

**Media upload (presigned S3 flow):**
1. `POST /media/upload` → get media_id + presigned upload_url
2. `PUT` raw bytes to the upload_url
3. Poll `GET /media/{media_id}` until status="ready"
4. Retry with exponential backoff (1s, 2s, 4s)

**Draft creation:**
- Builds posts array from thread segments
- Attaches media_ids to posts that have resolved visuals
- Sets schedule time (default: next day 6:30 AM UTC)
- Creates as draft (manual publish from Typefully UI)

**Output:** `TypefullyResult` — draft_id, private_url, scheduled_at, status.

---

## Data Models (`src/models/digest.ts`)

All validated with Zod schemas at pipeline boundaries.

| Schema | Stage | Purpose |
|--------|-------|---------|
| `NewsItemSchema` | Research output | Raw item with tier, event_type, source metadata |
| `CuratedStorySchema` | Editor output | Ranked story with one-liner angle, category, significance |
| `EditorialDecisionSchema` | Editor output | Publishability decision + story array |
| `VisualHintSchema` | Writer output | Machine-readable search criteria for visuals scout |
| `ThreadSegmentSchema` | Writer output | Single tweet with optional visual_hint and media |
| `XThreadSchema` | Writer output | Hook + segments + CTA |
| `CompanionPostSchema` | Writer output | Blog post title + markdown body |
| `ResolvedMediaSchema` | Visuals output | Local path, source type, alt text, content_type |
| `DigestContentSchema` | Pipeline output | Complete digest (thread + companion + date) |

---

## Configuration

**Required env vars:**
- `PARALLEL_API_KEY` — Parallel AI search (researcher + visuals)

**Required for publishing:**
- `TYPEFULLY_API_KEY` — Typefully API
- `TYPEFULLY_SOCIAL_SET_ID` — Account identifier

**Optional:**
- `GITHUB_TOKEN` — Higher GitHub API rate limits
- `GHOST_URL`, `GHOST_ADMIN_KEY` — Ghost blog publishing

**Watchlist:** `surfaces.json` — 20+ coding agents/tools (Claude Code, Cursor, Copilot, Aider, OpenHands, etc.) with GitHub repos, official RSS feeds, aliases, and categories.

---

## Run Outputs

Each run writes to `data/runs/digest-{date}/`:

```
digest-2026-04-28/
  raw-items.json            # researcher output
  editorial-decision.json   # editor output
  digest-content.json       # writer output (thread + companion)
  digest-content-with-media.json  # after visuals resolution
  qa-result.json            # QA scores and suggestions
  publish-result.json       # Typefully draft URL
  companion-post.md         # Ghost blog post
  media/                    # resolved visual files
    seg-4.jpg
    seg-7.png
    seg-8.png
  digest-state.json         # checkpoint tracker
```
