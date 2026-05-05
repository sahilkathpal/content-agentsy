/**
 * MCP tool definitions for the Researcher agent.
 * Each tool fetches from one source and returns NewsItem[] JSON.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createHash } from "node:crypto";
import { searchSubreddit, type RedditPost } from "../lib/sources/reddit.js";
import { fetchHNFrontPage, type HNHit } from "../lib/sources/hackernews.js";
import { searchGitHubTrending, type GitHubRepo } from "../lib/sources/github-trending.js";
import { fetchRecentReleases, type GitHubRelease } from "../lib/sources/github-releases.js";
import { detectVelocitySpikes, type VelocitySpike } from "../lib/sources/github-snapshots.js";
import { fetchOfficialFeeds, fetchCuratedFeeds, type RSSItem } from "./rss.js";
import { searchXViral, type XPost } from "./x-search.js";
import { normalizeUrl, loadLedger } from "../lib/ledger.js";
import { getWatchlist, getWatchlistRepos, getSubreddits, buildRelevanceMatchers } from "../lib/registry.js";
import { NewsItemSchema, type NewsItem } from "../models/digest.js";

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function hashUrl(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex").slice(0, 12);
}

function extractProjectUrl(text: string): string | undefined {
  if (!text) return undefined;
  const skipDomains = [
    "reddit.com", "redd.it", "i.redd.it", "imgur.com", "i.imgur.com",
    "twitter.com", "x.com", "youtube.com", "youtu.be", "discord.gg", "discord.com",
  ];
  for (const match of text.matchAll(/https?:\/\/[^\s\])<>,'"]+/g)) {
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

function rssToNewsItem(item: RSSItem, now: string, tier: number, eventType: string): NewsItem {
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
  const ageNote = repo.created_at ? `[repo created: ${repo.created_at.slice(0, 10)}] ` : "";
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
// Tool definitions
// ---------------------------------------------------------------------------

const fetchGithubReleasesTool = tool(
  "fetch_github_releases",
  "Fetch recent GitHub releases (T1) from coding agent watchlist repos. Returns NewsItem[] JSON.",
  {},
  async () => {
    const repos = getWatchlistRepos();
    const releases = await fetchRecentReleases(repos, 2);
    const now = new Date().toISOString();
    const items = releases.map((r) => releaseToNewsItem(r, now));
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const fetchOfficialRssTool = tool(
  "fetch_official_rss",
  "Fetch recent posts from official RSS feeds (T1): Anthropic, OpenAI, Cursor, GitHub, etc. Returns NewsItem[] JSON.",
  {},
  async () => {
    const rssItems = await fetchOfficialFeeds(1);
    const now = new Date().toISOString();
    const items = rssItems.map((item) => rssToNewsItem(item, now, 1, "blog_post"));
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const fetchHNTool = tool(
  "fetch_hn",
  "Fetch relevant stories from Hacker News front page (T2) — filtered to coding agent topics. Returns NewsItem[] JSON.",
  {},
  async () => {
    const relevanceMatchers = buildRelevanceMatchers();
    const hits = await fetchHNFrontPage(30, relevanceMatchers);
    const now = new Date().toISOString();
    const items = hits.map((hit) => hnToNewsItem(hit, now));
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const fetchXViralTool = tool(
  "fetch_x_viral",
  "Fetch viral X (Twitter) posts (T2) about coding agents with min 100 faves. Returns NewsItem[] JSON.",
  {},
  async () => {
    const watchlistNames = getWatchlist().map((w) => w.name);
    const posts = await searchXViral(1, watchlistNames);
    const now = new Date().toISOString();
    const items = posts.map((post) => xToNewsItem(post, now));
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const fetchGithubVelocityTool = tool(
  "fetch_github_velocity",
  "Detect GitHub repos with velocity spikes (T3) — rapid star growth indicating trending projects. Returns NewsItem[] JSON.",
  {},
  async () => {
    const repos = getWatchlistRepos();
    const spikes = await detectVelocitySpikes(repos);
    const now = new Date().toISOString();
    const items = spikes.map((spike) => velocityToNewsItem(spike, now));
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const fetchGithubTrendingTool = tool(
  "fetch_github_trending",
  "Fetch GitHub trending repositories (T3) for the day. Returns NewsItem[] JSON.",
  {},
  async () => {
    const repos = await searchGitHubTrending(1);
    const now = new Date().toISOString();
    const items = repos.map((repo) => githubToNewsItem(repo, now));
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const fetchCuratedRssTool = tool(
  "fetch_curated_rss",
  "Fetch recent posts from curated RSS feeds (T3): Simon Willison, Latent Space, HuggingFace papers. Returns NewsItem[] JSON.",
  {},
  async () => {
    const rssItems = await fetchCuratedFeeds(1);
    const now = new Date().toISOString();
    const items = rssItems.map((item) => rssToNewsItem(item, now, 3, "blog_post"));
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const fetchRedditTool = tool(
  "fetch_reddit",
  "Fetch hot Reddit posts (T4) from ClaudeAI, LocalLLaMA, ExperiencedDevs, and cursor subreddits — filtered for relevance. Returns NewsItem[] JSON.",
  {},
  async () => {
    const relevanceMatchers = buildRelevanceMatchers();
    const promises = getSubreddits().map((sub) =>
      searchSubreddit(sub, "", { sort: "hot", time: "day", limit: 15 }),
    );
    const results = await Promise.allSettled(promises);
    const items: NewsItem[] = [];
    const now = new Date().toISOString();

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const post of result.value) {
        const text = `${post.title} ${post.selftext ?? ""}`;
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
        if (relevant) items.push(redditToNewsItem(post, now));
      }
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  },
);

const deduplicateAndFilterTool = tool(
  "deduplicate_and_filter",
  "Deduplicate news items by normalized URL and filter out items already seen in the ledger. Call this LAST after combining all fetch results. Input: combined NewsItem[] from all fetch tools. Returns fresh NewsItem[] JSON.",
  { items: z.array(NewsItemSchema) },
  async (args) => {
    const { items } = args;

    // Deduplicate by normalized URL (prefer lower tier, higher score)
    const seen = new Map<string, NewsItem>();
    for (const item of items) {
      const key = normalizeUrl(item.url);
      const existing = seen.get(key);
      if (!existing || (item.tier ?? 4) < (existing.tier ?? 4) || (item.score ?? 0) > (existing.score ?? 0)) {
        seen.set(key, item);
      }
    }
    const deduped = [...seen.values()];

    // Filter by ledger (skip already-seen URLs)
    const ledger = loadLedger();
    const fresh = deduped.filter((item) => {
      const key = normalizeUrl(item.url);
      return !ledger[key];
    });

    console.log(`  [researcher] ${items.length} combined → ${deduped.length} deduped → ${fresh.length} fresh`);
    return { content: [{ type: "text" as const, text: JSON.stringify(fresh) }] };
  },
);

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

export const researchMcpServer = createSdkMcpServer({
  name: "research-tools",
  tools: [
    fetchGithubReleasesTool,
    fetchOfficialRssTool,
    fetchHNTool,
    fetchXViralTool,
    fetchGithubVelocityTool,
    fetchGithubTrendingTool,
    fetchCuratedRssTool,
    fetchRedditTool,
    deduplicateAndFilterTool,
  ],
});

export const RESEARCH_TOOL_NAMES = [
  "fetch_github_releases",
  "fetch_official_rss",
  "fetch_hn",
  "fetch_x_viral",
  "fetch_github_velocity",
  "fetch_github_trending",
  "fetch_curated_rss",
  "fetch_reddit",
  "deduplicate_and_filter",
];
