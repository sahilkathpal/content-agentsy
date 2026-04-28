import { createHash } from "node:crypto";
import { searchSubreddit, type RedditPost } from "../sources/reddit.js";
import { fetchHNFrontPage, type HNHit } from "../sources/hackernews.js";
import { searchGitHubTrending, type GitHubRepo } from "../sources/github-trending.js";
import { fetchRecentReleases, type GitHubRelease } from "../sources/github-releases.js";
import { detectVelocitySpikes, type VelocitySpike } from "../sources/github-snapshots.js";
import { fetchOfficialFeeds, fetchCuratedFeeds, type RSSItem } from "../tools/rss.js";
import { searchXViral, type XPost } from "../tools/x-search.js";
import { normalizeUrl, loadLedger } from "../ledger.js";
import { getWatchlist, getWatchlistRepos, buildRelevanceMatchers } from "../registry/registry.js";
import type { NewsItem } from "../models/digest.js";

// ---------------------------------------------------------------------------
// Subreddits for Tier 4 hot-post scanning
// ---------------------------------------------------------------------------
const SUBREDDITS = ["ClaudeAI", "LocalLLaMA", "ExperiencedDevs", "cursor"];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Collect coding agent news using event-driven monitoring.
 * Instead of keyword search, we ask: "what changed in the last 24 hours?"
 *
 * Tier 1 (always trust): GitHub releases, official RSS feeds
 * Tier 2 (high signal):  HN front page, X viral posts
 * Tier 3 (discovery):    GitHub velocity spikes + trending, curated RSS
 * Tier 4 (supplementary): Reddit hot posts
 */
export async function researchNews(): Promise<NewsItem[]> {
  console.log("  [researcher] collecting from event-driven sources in parallel…");

  const watchlist = getWatchlist();
  const watchlistRepos = getWatchlistRepos();
  const watchlistNames = watchlist.map((w) => w.name);
  const relevanceMatchers = buildRelevanceMatchers();

  const [
    releasesResult,
    officialRssResult,
    hnResult,
    xResult,
    velocityResult,
    trendingResult,
    curatedRssResult,
    redditResult,
  ] = await Promise.allSettled([
    collectGitHubReleases(watchlistRepos),        // T1
    collectOfficialRSS(),                         // T1
    collectHNFrontPage(relevanceMatchers),         // T2
    collectXViral(watchlistNames),                 // T2
    collectGitHubVelocity(watchlistRepos),         // T3
    collectGitHubTrending(),                       // T3
    collectCuratedRSS(),                           // T3
    collectRedditHot(relevanceMatchers),           // T4
  ]);

  const all: NewsItem[] = [];

  for (const [label, result] of [
    ["github_releases", releasesResult],
    ["official_rss", officialRssResult],
    ["hackernews", hnResult],
    ["x_viral", xResult],
    ["github_velocity", velocityResult],
    ["github_trending", trendingResult],
    ["curated_rss", curatedRssResult],
    ["reddit", redditResult],
  ] as const) {
    if (result.status === "fulfilled") {
      all.push(...result.value);
      console.log(`  [researcher] ${label}: ${result.value.length} items`);
    } else {
      console.warn(`  [researcher] ${label} failed:`, result.reason);
    }
  }

  // Deduplicate by normalized URL
  const deduped = deduplicateItems(all);
  console.log(`  [researcher] ${all.length} raw → ${deduped.length} after dedup`);

  // Filter out URLs already seen in the ledger (recurring)
  const ledger = loadLedger();
  const fresh = deduped.filter((item) => {
    const key = normalizeUrl(item.url);
    return !ledger[key];
  });
  console.log(`  [researcher] ${fresh.length} items after ledger filter`);

  return fresh;
}

// ---------------------------------------------------------------------------
// Tier 1 — Always trust
// ---------------------------------------------------------------------------

async function collectGitHubReleases(repos: string[]): Promise<NewsItem[]> {
  const releases = await fetchRecentReleases(repos, 2);
  const now = new Date().toISOString();
  return releases.map((r) => releaseToNewsItem(r, now));
}

async function collectOfficialRSS(): Promise<NewsItem[]> {
  const rssItems = await fetchOfficialFeeds(1);
  const now = new Date().toISOString();
  return rssItems.map((item) => rssToNewsItem(item, now, 1, "blog_post"));
}

// ---------------------------------------------------------------------------
// Tier 2 — High signal (community-filtered)
// ---------------------------------------------------------------------------

async function collectHNFrontPage(
  relevanceMatchers: ReturnType<typeof buildRelevanceMatchers>,
): Promise<NewsItem[]> {
  const hits = await fetchHNFrontPage(30, relevanceMatchers);
  const now = new Date().toISOString();
  return hits.map((hit) => hnToNewsItem(hit, now));
}

async function collectXViral(watchlistNames: string[]): Promise<NewsItem[]> {
  const posts = await searchXViral(1, watchlistNames);
  const now = new Date().toISOString();
  return posts.map((post) => xToNewsItem(post, now));
}

// ---------------------------------------------------------------------------
// Tier 3 — Discovery
// ---------------------------------------------------------------------------

async function collectGitHubVelocity(repos: string[]): Promise<NewsItem[]> {
  const spikes = await detectVelocitySpikes(repos);
  const now = new Date().toISOString();
  return spikes.map((spike) => velocityToNewsItem(spike, now));
}

async function collectGitHubTrending(): Promise<NewsItem[]> {
  const repos = await searchGitHubTrending(1);
  const now = new Date().toISOString();
  return repos.map((repo) => githubToNewsItem(repo, now));
}

async function collectCuratedRSS(): Promise<NewsItem[]> {
  const rssItems = await fetchCuratedFeeds(1);
  const now = new Date().toISOString();
  return rssItems.map((item) => rssToNewsItem(item, now, 3, "blog_post"));
}

// ---------------------------------------------------------------------------
// Tier 4 — Supplementary
// ---------------------------------------------------------------------------

async function collectRedditHot(
  relevanceMatchers: ReturnType<typeof buildRelevanceMatchers>,
): Promise<NewsItem[]> {
  // Fetch hot posts from each sub, then filter for relevance
  const promises = SUBREDDITS.map((sub) =>
    searchSubreddit(sub, "", { sort: "hot", time: "day", limit: 15 })
  );

  const results = await Promise.allSettled(promises);
  const items: NewsItem[] = [];
  const now = new Date().toISOString();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const post of result.value) {
      const text = `${post.title} ${post.selftext ?? ""}`;

      // Relevance filter: match watchlist terms
      let relevant = relevanceMatchers.simpleRe.test(text);
      if (!relevant) {
        for (const name of relevanceMatchers.ambiguousNames) {
          const nameRe = new RegExp(`\\b${name}\\b`, "i");
          if (nameRe.test(text) && relevanceMatchers.contextRe.test(text)) {
            relevant = true;
            break;
          }
        }
      }

      if (relevant) {
        items.push(redditToNewsItem(post, now));
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function extractProjectUrl(text: string): string | undefined {
  if (!text) return undefined;
  const urlRegex = /https?:\/\/[^\s\])<>,'"]+/g;
  const skipDomains = [
    "reddit.com", "redd.it", "i.redd.it",
    "imgur.com", "i.imgur.com",
    "twitter.com", "x.com",
    "youtube.com", "youtu.be",
    "discord.gg", "discord.com",
  ];
  for (const match of text.matchAll(urlRegex)) {
    const url = match[0].replace(/[.),;:!?]+$/, "");
    if (!skipDomains.some((d) => url.includes(d))) return url;
  }
  return undefined;
}

function releaseToNewsItem(release: GitHubRelease, now: string): NewsItem {
  return {
    id: hashUrl(release.html_url),
    title: `${release.repo} ${release.tag_name}: ${release.name}`,
    url: release.html_url,
    source: "github_release",
    summary: release.body?.slice(0, 500) || undefined,
    published_at: release.published_at,
    collected_at: now,
    freshness: "new",
    tier: 1,
    event_type: "release",
  };
}

function velocityToNewsItem(spike: VelocitySpike, now: string): NewsItem {
  return {
    id: hashUrl(spike.html_url),
    title: `${spike.repo} — +${spike.delta} stars (${spike.delta_pct}% growth)`,
    url: spike.html_url,
    source: "github_velocity",
    summary: spike.description ?? undefined,
    score: spike.stars_today,
    published_at: now,
    collected_at: now,
    freshness: "new",
    tier: 3,
    event_type: "velocity_spike",
  };
}

function redditToNewsItem(post: RedditPost, now: string): NewsItem {
  return {
    id: hashUrl(post.url),
    title: post.title,
    url: post.permalink || post.url,
    source: `reddit/r/${post.subreddit}`,
    summary: post.selftext?.slice(0, 500),
    score: post.score,
    num_comments: post.num_comments,
    published_at: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
    collected_at: now,
    freshness: "new",
    project_url: extractProjectUrl(post.selftext ?? ""),
    tier: 4,
    event_type: "community_discussion",
  };
}

function hnToNewsItem(hit: HNHit, now: string): NewsItem {
  return {
    id: `hn-${hit.objectID}`,
    title: hit.title,
    url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
    source: "hackernews",
    summary: undefined,
    score: hit.points,
    num_comments: hit.num_comments,
    published_at: hit.created_at,
    collected_at: now,
    freshness: "new",
    tier: 2,
    event_type: "community_discussion",
  };
}

function rssToNewsItem(item: RSSItem, now: string, tier: number = 1, eventType: string = "blog_post"): NewsItem {
  return {
    id: hashUrl(item.url),
    title: item.title,
    url: item.url,
    source: `rss/${item.feed_name}`,
    summary: item.summary,
    published_at: item.published_at,
    collected_at: now,
    freshness: "new",
    tier,
    event_type: eventType as NewsItem["event_type"],
  };
}

function xToNewsItem(post: XPost, now: string): NewsItem {
  return {
    id: hashUrl(post.url),
    title: `@${post.author}: ${post.text.slice(0, 100)}`,
    url: post.url,
    source: "x_viral",
    summary: post.text,
    published_at: post.published_at,
    collected_at: now,
    freshness: "new",
    tier: 2,
    event_type: "viral_post",
  };
}

function githubToNewsItem(repo: GitHubRepo, now: string): NewsItem {
  const ageNote = repo.created_at
    ? `[repo created: ${repo.created_at.slice(0, 10)}] `
    : "";
  return {
    id: hashUrl(repo.html_url),
    title: repo.full_name,
    url: repo.html_url,
    source: "github",
    summary: `${ageNote}${repo.description ?? ""}`.trim() || undefined,
    score: repo.stargazers_count,
    published_at: repo.pushed_at,
    collected_at: now,
    freshness: "new",
    tier: 3,
    event_type: "trending",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateItems(items: NewsItem[]): NewsItem[] {
  const seen = new Map<string, NewsItem>();
  for (const item of items) {
    const key = normalizeUrl(item.url);
    const existing = seen.get(key);
    // Prefer higher-tier (lower number) items, then higher score
    if (!existing || (item.tier ?? 4) < (existing.tier ?? 4) || (item.score ?? 0) > (existing.score ?? 0)) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

function hashUrl(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex").slice(0, 12);
}
