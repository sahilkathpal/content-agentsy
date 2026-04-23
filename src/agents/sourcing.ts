import { writeFileSync } from "node:fs";
import type { Surface, Registry } from "../models/surface.js";
import { getSubredditsForSurface, getCompetitorsForSurface } from "../registry/registry.js";
import { searchSubreddit, getSubredditHot, type RedditPost } from "../sources/reddit.js";
import { searchHN, type HNHit } from "../sources/hackernews.js";
import { extractUrls, type ExtractResult } from "../sources/parallel-extract.js";

/** A raw signal from any source, tagged with its origin. */
export type RawSignal = (RedditPost | HNHit | ExtractResult) & { _source: string };

export interface RawBuckets {
  community_pain: RawSignal[];
  official_change: RawSignal[];
  demand: RawSignal[];
  market_framing: RawSignal[];
}

/**
 * Collect raw signals from all buckets in parallel.
 * Writes raw results to `outPath` and returns them.
 */
export async function runSourcing(surface: Surface, registry: Registry, outPath: string): Promise<RawBuckets> {
  console.log(`  [sourcing] ${surface.id}: firing all buckets in parallel…`);

  const subreddits = getSubredditsForSurface(registry, surface.id);
  const competitors = getCompetitorsForSurface(registry, surface.id);

  const [communityResults, officialResults, marketResults] = await Promise.allSettled([
    collectCommunityPain(surface, subreddits.map((s) => s.name)),
    collectOfficialChanges(surface),
    collectMarketFraming(surface, competitors),
  ]);

  const rawBuckets: RawBuckets = {
    community_pain: communityResults.status === "fulfilled" ? communityResults.value : [],
    official_change: officialResults.status === "fulfilled" ? officialResults.value : [],
    demand: [],
    market_framing: marketResults.status === "fulfilled" ? marketResults.value : [],
  };

  for (const [label, result] of Object.entries({
    community_pain: communityResults,
    official_change: officialResults,
    market_framing: marketResults,
  })) {
    if (result.status === "rejected") {
      console.warn(`  [sourcing] ${surface.id}: ${label} failed:`, result.reason);
    }
  }

  const totalRaw =
    rawBuckets.community_pain.length +
    rawBuckets.official_change.length +
    rawBuckets.market_framing.length;

  console.log(`  [sourcing] ${surface.id}: ${totalRaw} raw results → ${outPath}`);
  writeFileSync(outPath, JSON.stringify(rawBuckets, null, 2));

  return rawBuckets;
}

// --- Bucket collectors ---

async function collectCommunityPain(surface: Surface, subredditNames: string[]): Promise<RawSignal[]> {
  const results: RawSignal[] = [];

  // Pass 1 (new): recent posts by date
  const newRedditPromises = subredditNames.flatMap((sub) =>
    surface.search_terms.slice(0, 3).map((term) =>
      searchSubreddit(sub, term, { sort: "new", time: "day", limit: 10 })
    )
  );
  const newHnPromises = surface.search_terms.slice(0, 3).map((term) =>
    searchHN(term, { daysBack: 2, hitsPerPage: 10 })
  );

  // Pass 2 (hot): popular/trending posts
  const hotRedditPromises = subredditNames.map((sub) =>
    getSubredditHot(sub, { limit: 10 })
  );
  const hotHnPromises = surface.search_terms.slice(0, 3).map((term) =>
    searchHN(term, { daysBack: 7, hitsPerPage: 10, sortByDate: false })
  );

  const [newRedditResults, newHnResults, hotRedditResults, hotHnResults] = await Promise.all([
    Promise.allSettled(newRedditPromises),
    Promise.allSettled(newHnPromises),
    Promise.allSettled(hotRedditPromises),
    Promise.allSettled(hotHnPromises),
  ]);

  for (const r of newRedditResults) {
    if (r.status === "fulfilled") {
      results.push(...r.value.map((p) => ({ ...p, _source: `reddit/${p.subreddit}` })));
    }
  }
  for (const r of newHnResults) {
    if (r.status === "fulfilled") {
      results.push(...r.value.map((h) => ({ ...h, _source: "hackernews" })));
    }
  }
  for (const r of hotRedditResults) {
    if (r.status === "fulfilled") {
      results.push(...r.value.map((p) => ({ ...p, _source: `reddit/${p.subreddit}` })));
    }
  }
  for (const r of hotHnResults) {
    if (r.status === "fulfilled") {
      results.push(...r.value.map((h) => ({ ...h, _source: "hackernews" })));
    }
  }

  return results;
}

async function collectOfficialChanges(surface: Surface): Promise<RawSignal[]> {
  const urls = surface.official_urls ?? [];
  if (urls.length === 0) return [];
  const extracted = await extractUrls(urls, `Recent changes, updates, or announcements related to: ${surface.label}`);
  return extracted.map((e) => ({ ...e, _source: "official_docs" }));
}

async function collectMarketFraming(
  surface: Surface,
  competitors: Array<{ name: string; watched_urls: string[] }>
): Promise<RawSignal[]> {
  const allUrls = competitors.flatMap((c) => c.watched_urls);
  if (allUrls.length === 0) return [];
  const extracted = await extractUrls(allUrls, `Competitor positioning, features, and messaging related to: ${surface.label}`);
  return extracted.map((e) => {
    const comp = competitors.find((c) => c.watched_urls.includes(e.url));
    return { ...e, _source: `competitor/${comp?.name ?? "unknown"}` };
  });
}
