import { client } from "./parallel-extract.js";

export interface RedditPost {
  title: string;
  selftext: string;
  url: string;
  subreddit: string;
  score: number | undefined;
  num_comments: number | undefined;
  created_utc: number | undefined;
  permalink: string;
  top_comments: string[];
}

export interface RedditSearchOptions {
  sort?: "new" | "relevance" | "top" | "hot";
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
  limit?: number;
}

/**
 * Convert a time filter to an RFC 3339 after_date string.
 */
function timeToAfterDate(time: string): string | undefined {
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const offsets: Record<string, number> = {
    hour: msPerDay / 24,
    day: msPerDay,
    week: 7 * msPerDay,
    month: 30 * msPerDay,
    year: 365 * msPerDay,
  };
  const offset = offsets[time];
  if (!offset) return undefined;
  return new Date(now - offset).toISOString().slice(0, 10);
}

/**
 * Extract subreddit name from a Reddit URL.
 */
function extractSubreddit(url: string): string {
  const match = url.match(/reddit\.com\/r\/([^/]+)/);
  return match?.[1] ?? "unknown";
}

/**
 * Parse a YYYY-MM-DD publish_date into a Unix timestamp (seconds).
 */
function parsePublishDate(dateStr: string | undefined | null): number | undefined {
  if (!dateStr) return undefined;
  const ms = new Date(dateStr).getTime();
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/**
 * Convert Parallel search results into RedditPost objects,
 * then enrich with extracted content (post body + top-level comments).
 */
async function enrichWithExtract(
  results: Array<{ url: string; title?: string | null; excerpts?: string[] | null; publish_date?: string | null }>,
  subreddit: string,
): Promise<RedditPost[]> {
  if (results.length === 0) return [];

  const urls = results.map((r) => r.url);

  let extractMap = new Map<string, { full_content?: string | null }>();

  try {
    const extractResponse = await client().beta.extract({
      urls,
      objective: "Extract the original post text and top-level comments from this Reddit thread. Separate the post body from the comment replies.",
      full_content: { max_chars_per_result: 3000 },
    });

    for (const r of extractResponse.results) {
      extractMap.set(r.url, r);
    }
  } catch (err) {
    console.warn(`  [reddit] Parallel extract failed for ${urls.length} URLs, falling back to search excerpts:`, err);
  }

  return results.map((r) => {
    const extracted = extractMap.get(r.url);
    const fullContent = extracted?.full_content ?? "";

    // Split content: first block is typically the post body, rest are comments
    const sections = fullContent.split(/\n---\n|\n\n(?=[-•*] )/);
    const selftext = sections[0]?.trim().slice(0, 2000) ?? r.excerpts?.join("\n\n").slice(0, 2000) ?? "";
    const topComments = sections.slice(1).map((s) => s.trim()).filter(Boolean);

    return {
      title: r.title ?? "",
      selftext,
      url: r.url,
      subreddit: extractSubreddit(r.url) || subreddit,
      score: undefined,
      num_comments: undefined,
      created_utc: parsePublishDate(r.publish_date),
      permalink: r.url,
      top_comments: topComments,
    };
  });
}

export async function searchSubreddit(
  subreddit: string,
  query: string,
  options: RedditSearchOptions = {}
): Promise<RedditPost[]> {
  const { time = "month", limit = 25 } = options;

  try {
    const afterDate = timeToAfterDate(time);

    const response = await client().beta.search({
      objective: `Recent discussions about "${query}" in the r/${subreddit} subreddit`,
      search_queries: [`site:reddit.com/r/${subreddit} ${query}`],
      source_policy: {
        include_domains: ["reddit.com"],
        ...(afterDate ? { after_date: afterDate } : {}),
      },
      mode: "fast",
      max_results: limit,
      excerpts: { max_chars_per_result: 2000 },
    });

    const redditResults = response.results.filter((r) =>
      r.url.includes("reddit.com")
    );

    return enrichWithExtract(redditResults, subreddit);
  } catch (err) {
    console.warn(`Reddit search failed for r/${subreddit} q="${query}":`, err);
    return [];
  }
}

/**
 * Fetch hot/trending posts from a subreddit via Parallel search.
 */
export async function getSubredditHot(
  subreddit: string,
  options: { limit?: number } = {}
): Promise<RedditPost[]> {
  const { limit = 25 } = options;

  try {
    const response = await client().beta.search({
      objective: `Popular and trending discussions in the r/${subreddit} subreddit`,
      search_queries: [`site:reddit.com/r/${subreddit}`],
      source_policy: {
        include_domains: ["reddit.com"],
      },
      mode: "fast",
      max_results: limit,
      excerpts: { max_chars_per_result: 2000 },
    });

    const redditResults = response.results.filter((r) =>
      r.url.includes("reddit.com")
    );

    return enrichWithExtract(redditResults, subreddit);
  } catch (err) {
    console.warn(`Reddit hot failed for r/${subreddit}:`, err);
    return [];
  }
}
