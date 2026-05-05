---
name: news-research-sources
description: Event-driven news sourcing strategy for coding agents and developer tooling. Defines source tiers, freshness rules, and collection priorities.
when_to_use: When researching news about AI coding agents, developer tools, and related infrastructure.
version: "1.0"
tags: ["research", "news", "sourcing", "coding-agents"]
---

# News Research Sources — Coding Agents

## Strategy: Event-Driven, Not Keyword Search

Don't search for keywords. Ask: **what changed in the last 24 hours?** Monitor signals that indicate something actually happened — a release, a spike, a discussion — rather than scanning for mentions.

## Source Tiers

### Tier 1 — Always Trust
High-signal, low-noise. Include by default.

- **GitHub releases** — Official releases from tracked repos. A release means something shipped.
- **Official RSS feeds** — Blog posts from Anthropic, OpenAI, GitHub, Cursor, and other major toolmakers.

### Tier 2 — High Signal
Community-filtered. If it made the front page, something real happened.

- **Hacker News front page** — Filter for relevance to coding agents. Ambiguous terms (Cursor, Amp, Bolt) require co-occurrence with AI/coding/agent context.
- **X viral posts** — Posts from tracked accounts and topics trending among developers.

### Tier 3 — Discovery Layer
Surface emerging signals before they break through.

- **GitHub velocity spikes** — Repos gaining >100 stars/24h or >5% growth. Indicates sudden attention.
- **GitHub trending** — New repos (<30 days old) and active established repos (>500 stars, recent pushes) in coding-agent topics.
- **Curated RSS feeds** — Hand-picked technical blogs and newsletters in the coding agents space.

### Tier 4 — Supplementary
Useful context, lower signal-to-noise.

- **Reddit hot posts** — Subreddits: ClaudeAI, LocalLLaMA, ExperiencedDevs, cursor. Filter for relevance; most posts are not news.

## Freshness Rules

- **72-hour cutoff** — Items older than 72 hours are stale for a daily digest. Drop them unless they are T1 (official releases may need covering even if slightly delayed).
- **Deduplication** — Normalize URLs before comparing. A GitHub release and a Reddit post about the same release are the same event — merge them.
- **Ledger check** — Skip URLs seen in the last 90 days. Recurring content is not news.

## Output Format

Each collected item should be a `NewsItem` with:
- `id`: hash of the normalized URL
- `title`: original headline or post title
- `url`: canonical URL
- `source`: source identifier (e.g., `github_release`, `hackernews`, `reddit/r/ClaudeAI`)
- `summary`: 1-2 sentence description of what happened
- `tier`: 1–4
- `event_type`: `release` | `blog_post` | `trending` | `velocity_spike` | `viral_post` | `community_discussion`
- `published_at`: ISO timestamp from the source
- `collected_at`: ISO timestamp of collection
