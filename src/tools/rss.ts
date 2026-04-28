import { XMLParser } from "fast-xml-parser";

export interface RSSItem {
  title: string;
  url: string;
  published_at: string | undefined;
  summary: string;
  feed_name: string;
}

interface FeedConfig {
  name: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Tier 1 — Official blogs and changelogs (high trust, zero noise)
// ---------------------------------------------------------------------------
const OFFICIAL_FEEDS: FeedConfig[] = [
  { name: "anthropic_engineering", url: "https://raw.githubusercontent.com/conoro/anthropic-engineering-rss-feed/main/anthropic_engineering_rss.xml" },
  { name: "openai_news", url: "https://openai.com/news/rss.xml" },
  { name: "cursor_changelog", url: "https://changelog.cursor.com/feed" },
  { name: "github_blog", url: "https://github.blog/feed/" },
  { name: "google_deepmind", url: "https://blog.google/technology/ai/rss/" },
  { name: "huggingface_blog", url: "https://huggingface.co/blog/feed.xml" },
  { name: "aws_devops_blog", url: "https://aws.amazon.com/blogs/devops/feed/" },
  { name: "sourcegraph_blog", url: "https://sourcegraph.com/blog/rss.xml" },
];

// ---------------------------------------------------------------------------
// Tier 3 — Curated community feeds (high-quality independent voices)
// ---------------------------------------------------------------------------
const CURATED_FEEDS: FeedConfig[] = [
  { name: "simonwillison", url: "https://simonwillison.net/atom/everything/" },
  { name: "latentspace", url: "https://www.latent.space/feed" },
  { name: "hf_daily_papers", url: "https://papers.takara.ai/api/feed" },
];

// Combined for backward compat
const FEEDS: FeedConfig[] = [...OFFICIAL_FEEDS, ...CURATED_FEEDS];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** Fetch Tier 1 official blog/changelog feeds. */
export async function fetchOfficialFeeds(maxAgeDays: number = 1): Promise<RSSItem[]> {
  return fetchFeedGroup(OFFICIAL_FEEDS, maxAgeDays, "official-rss");
}

/** Fetch Tier 3 curated community feeds. */
export async function fetchCuratedFeeds(maxAgeDays: number = 1): Promise<RSSItem[]> {
  return fetchFeedGroup(CURATED_FEEDS, maxAgeDays, "curated-rss");
}

/** Fetch all configured RSS/Atom feeds (backward compat). */
export async function fetchAllFeeds(maxAgeDays: number = 1): Promise<RSSItem[]> {
  return fetchFeedGroup(FEEDS, maxAgeDays, "rss");
}

async function fetchFeedGroup(feeds: FeedConfig[], maxAgeDays: number, label: string): Promise<RSSItem[]> {
  const results = await Promise.allSettled(
    feeds.map((feed) => fetchFeed(feed, maxAgeDays))
  );

  const items: RSSItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      console.warn(`  [${label}] ${feeds[i].name} failed:`, result.reason);
    }
  }

  return items;
}

/**
 * Fetch a single RSS/Atom feed and return recent items.
 */
export async function fetchFeed(feed: FeedConfig, maxAgeDays: number): Promise<RSSItem[]> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  const response = await fetch(feed.url, {
    headers: { "User-Agent": "content-agentsy/1.0" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${feed.url}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);

  const items: RSSItem[] = [];

  // Handle RSS 2.0
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems) {
    for (const item of Array.isArray(rssItems) ? rssItems : [rssItems]) {
      const pubDate = item.pubDate ?? item["dc:date"];
      const published = pubDate ? new Date(pubDate) : undefined;
      if (published && published.getTime() < cutoff) continue;

      items.push({
        title: stripHtml(item.title ?? ""),
        url: item.link ?? "",
        published_at: published?.toISOString(),
        summary: stripHtml(item.description ?? "").slice(0, 500),
        feed_name: feed.name,
      });
    }
  }

  // Handle Atom
  const atomEntries = parsed?.feed?.entry;
  if (atomEntries) {
    for (const entry of Array.isArray(atomEntries) ? atomEntries : [atomEntries]) {
      const updated = entry.updated ?? entry.published;
      const published = updated ? new Date(updated) : undefined;
      if (published && published.getTime() < cutoff) continue;

      const link = Array.isArray(entry.link)
        ? entry.link.find((l: Record<string, string>) => l["@_rel"] === "alternate")?.["@_href"] ?? entry.link[0]?.["@_href"]
        : entry.link?.["@_href"] ?? entry.link;

      items.push({
        title: stripHtml(typeof entry.title === "object" ? entry.title["#text"] ?? "" : entry.title ?? ""),
        url: link ?? "",
        published_at: published?.toISOString(),
        summary: stripHtml(typeof entry.summary === "object" ? entry.summary["#text"] ?? "" : entry.summary ?? entry.content ?? "").slice(0, 500),
        feed_name: feed.name,
      });
    }
  }

  return items;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}
