# Prompt Dictionary

When prompting Claude Code on this project, use these terms precisely. Each entry maps the short phrase you'll type to what it means in this codebase.

---

## Content Formats

| Say this | It means |
|---|---|
| **canonical post** | The full 1500–3000 word blog post published on codeongrass.com; the primary output of the Creator stage |
| **syndication asset** | Markdown republication of a canonical post for Dev.to or Hashnode, with frontmatter and backlink |
| **X thread** | A Twitter/X multi-post thread; comes in variants: `single_story`, `short_thread`, `standard_thread`, `full_digest` |
| **news digest** | The daily X thread summarizing 2–4 coding-agent news stories; produced by the daily news workflow |
| **Okara format** | The specific news-roundup thread style: lowercase hook line, `>` prefixed bullets, one specific fact per bullet, reply-baiting closer |
| **native unit** | Platform-native content derived from a canonical post (X thread segment, LinkedIn post); meant to feel native, not like a link drop |
| **companion post** | Ghost blog post that holds source links and context for a daily news digest |
| **distribution packet** | The complete "make this thing" spec: opportunity + format + channel + voice type + Grass role + intent mode + proof assets |

---

## Pipeline Stages

| Say this | It means |
|---|---|
| **Scout** | 3-layer stage: Sourcing → Structuring → Analysis; finds and clusters raw signals into opportunities |
| **Strategist** | Ranks opportunities by composite score; outputs distribution packets |
| **Creator** | Writes GEO-optimized canonical blog posts from distribution packets |
| **Derivatives** | Generates native units (X threads, LinkedIn) and syndication assets from canonical posts |
| **Publisher** | Publishes canonical posts to Ghost CMS; builds the asset manifest |
| **Syndication Publisher** | Publishes syndication assets to Dev.to and Hashnode |
| **Scorer** | Pulls SEO/GEO metrics and writes scorecards per published asset |
| **Analyst** | Reviews performance data; recommends registry and heuristic updates |
| **daily news workflow** | The 5-stage daily digest pipeline: Research → Edit → Write → Visuals → Publish |

---

## Daily News Workflow Agents

| Say this | It means |
|---|---|
| **News Researcher** | Collects coding-agent news from RSS, GitHub, watchlist sources |
| **News Editor** | Curates clusters into publishable stories with newsworthiness judgment |
| **News Writer** | Writes the X thread from curated stories |
| **News QA** | Validates content quality, determines thread format variant |
| **Visuals Scout** | Resolves visual hints (screenshots, diagrams) from writer output |

---

## Brand & Voice

| Say this | It means |
|---|---|
| **Grass** | The brand/product; codeongrass.com; VM-first compute for AI coding agents |
| **Grass role** | How prominently the brand appears: `light` / `evaluate` / `integrate` / `execute` |
| **light role** | Grass absent or incidental; pure topical authority piece |
| **evaluate role** | Grass is one option among alternatives; comparison post |
| **integrate role** | Technique-first article with a dedicated Grass section |
| **execute role** | Grass is the subject; full tutorial on using Grass |
| **engineer voice** | Technical depth, code examples, precise implementation details |
| **founder voice** | Strategic framing, business context, first-person lessons |
| **community voice** | Conversational, peer-to-peer, "we/you"; used for news digests and discussions |

---

## Intent Modes

| Say this | It means |
|---|---|
| **M0 / resolve mode** | Post for users debugging or understanding something ("why is X broken?") |
| **M1 / evaluate mode** | Post for users comparing options ("X vs Y") |
| **M2 / execute mode** | Post for users setting something up ("how to configure X") |

---

## Signals & Sourcing

| Say this | It means |
|---|---|
| **signal** | One structured data point: title, summary, URL, source, freshness |
| **signal bucket** | Category: `official_change`, `community_pain`, `demand`, `market_framing` |
| **opportunity** | Clustered signals forming a single content angle, with confidence score |
| **proof asset** | Specific evidence woven into content: a quote, benchmark, stat, screenshot |
| **surface** | A tracked topic area (slug); defined in `surfaces.json` |
| **registry** | `surfaces.json` — the master config of surfaces, watchlist, subreddits, competitors |
| **watchlist** | Tracked tools monitored for event-driven news (Claude Code, Cursor, Copilot, etc.) |
| **ledger** | Cross-run URL freshness tracker; prevents duplicate opportunity processing |

---

## Scoring & Metrics

| Say this | It means |
|---|---|
| **composite score** | Weighted rank for a distribution packet: demand×3 + proximity×2 + proof×2 + freshness×1.5 + defensibility×1.5 |
| **GEO** | Generative Engine Optimization — structuring content so LLMs extract and cite it |
| **GEO metrics** | Citation count, AI search inclusion, share of voice, extractability score (from Otterly) |
| **SEO metrics** | Impressions, clicks, CTR, ranking positions (from Google Search Console / GSC) |
| **Otterly** | The tool that tracks how often codeongrass.com content is cited by LLMs |
| **GSC** | Google Search Console; source of keyword/query demand signals |
| **quadrant analysis** | 2×2 classification: star (high SEO + GEO), SEO-only, GEO-only, orphan (low both) |

---

## Publishing & Infrastructure

| Say this | It means |
|---|---|
| **Ghost post** | A blog post published to the Ghost 5+ CMS; requires Lexical JSON envelope, not raw HTML |
| **manifest** | The `manifest.json` tracking all asset IDs, channels, and publish URLs for a run |
| **run state** | `run-state.json` checkpoint file tracking stage status for the main pipeline |
| **digest state** | `digest-state.json` checkpoint file for the daily news workflow |
| **Typefully** | X thread draft and scheduling tool; target for publishing native units |

---

## Output Files (quick reference)

| File | Produced by |
|---|---|
| `scout-output.json` | Scout (Analysis layer) |
| `strategist-output.json` | Strategist |
| `creator-output.json` | Creator |
| `derivatives-output.json` | Derivatives |
| `publisher-output.json` | Publisher |
| `syndication-publisher-output.json` | Syndication Publisher |
| `scorecards.json` | Scorer |
| `analyst-output.json` | Analyst |
| `manifest.json` | Publisher (manifest builder) |
| `digest-<date>/` | Daily news workflow |
