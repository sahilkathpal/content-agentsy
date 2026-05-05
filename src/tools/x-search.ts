import { client } from "../lib/sources/parallel-client.js";

export interface XPost {
  url: string;
  author: string;
  text: string;
  published_at: string | undefined;
}

/**
 * Build viral-focused X search queries with high engagement floors.
 * Two strategies: watchlist-specific (min 100 faves) + domain-wide viral (min 200 faves).
 */
function buildViralQueries(afterDate: string, watchlistNames: string[]) {
  const queries: Array<{ objective: string; query: string }> = [];

  // Strategy 1: Watchlist-specific viral — chunk names into groups of 5
  for (let i = 0; i < watchlistNames.length; i += 5) {
    const chunk = watchlistNames.slice(i, i + 5);
    const terms = chunk.map((b) => `"${b}"`).join(" OR ");
    queries.push({
      objective: `Viral posts about ${chunk.join(", ")} — launches, updates, reactions`,
      query: `site:x.com (${terms}) min_faves:100 -filter:replies since:${afterDate}`,
    });
  }

  // Strategy 2: Domain-wide viral — only the truly viral moments
  queries.push({
    objective: `Viral posts about coding agents, AI coding tools — major moments only`,
    query: `site:x.com ("coding agent" OR "AI coding" OR "vibe coding" OR "agentic coding") min_faves:200 -filter:replies since:${afterDate}`,
  });

  return queries;
}

/**
 * Search X/Twitter for viral posts about coding agents.
 * Higher engagement floor than keyword search — finds signal, not noise.
 */
export async function searchXViral(
  maxAgeDays: number = 1,
  watchlistNames: string[] = [],
): Promise<XPost[]> {
  const afterDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const queries = buildViralQueries(afterDate, watchlistNames);

  const results = await Promise.allSettled(
    queries.map((q) => searchXQuery(q.objective, q.query, afterDate))
  );

  const posts: XPost[] = [];
  const seenUrls = new Set<string>();

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const post of result.value) {
        if (!seenUrls.has(post.url)) {
          seenUrls.add(post.url);
          posts.push(post);
        }
      }
    }
  }

  return posts;
}

/** @deprecated Use searchXViral instead */
export async function searchXPosts(
  maxAgeDays: number = 1,
  brands: string[] = [],
): Promise<XPost[]> {
  return searchXViral(maxAgeDays, brands);
}

async function searchXQuery(
  objective: string,
  query: string,
  afterDate: string,
): Promise<XPost[]> {
  try {
    const response = await client().beta.search({
      objective,
      search_queries: [query],
      source_policy: {
        include_domains: ["x.com", "twitter.com"],
        after_date: afterDate,
      },
      mode: "fast",
      max_results: 15,
      excerpts: { max_chars_per_result: 500 },
    });

    return response.results
      .filter((r) => r.url && (r.url.includes("x.com") || r.url.includes("twitter.com")))
      .map((r) => ({
        url: r.url,
        author: extractAuthor(r.url),
        text: r.excerpts?.join(" ").slice(0, 500) ?? r.title ?? "",
        published_at: r.publish_date ?? undefined,
      }));
  } catch (err) {
    console.warn(`  [x-search] query failed:`, err);
    return [];
  }
}

function extractAuthor(url: string): string {
  const match = url.match(/(?:x\.com|twitter\.com)\/([^/]+)/);
  return match?.[1] ?? "unknown";
}
