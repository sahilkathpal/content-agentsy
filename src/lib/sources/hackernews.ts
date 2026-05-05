export interface HNHit {
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
  objectID: string;
}

export interface HNSearchOptions {
  daysBack?: number;
  hitsPerPage?: number;
  sortByDate?: boolean;
}

export async function searchHN(
  query: string,
  options: HNSearchOptions = {}
): Promise<HNHit[]> {
  const { daysBack = 30, hitsPerPage = 20, sortByDate = true } = options;
  const since = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const params = new URLSearchParams({
    query,
    tags: "story",
    numericFilters: `created_at_i>${since}`,
    hitsPerPage: String(hitsPerPage),
  });

  // search_by_date sorts by date; search sorts by relevance/points
  const endpoint = sortByDate ? "search_by_date" : "search";
  const url = `https://hn.algolia.com/api/v1/${endpoint}?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

  if (!res.ok) {
    console.warn(`HN search failed for q="${query}": ${res.status}`);
    return [];
  }

  const json = await res.json();
  const hits: any[] = json?.hits ?? [];

  return hits.map((h: any) => ({
    title: h.title,
    url: h.url ?? null,
    points: h.points ?? 0,
    num_comments: h.num_comments ?? 0,
    created_at: h.created_at,
    objectID: h.objectID,
  }));
}

/**
 * Fetch HN front page stories and filter for coding-agent relevance.
 * Single API call — gets what's already trending, not keyword search.
 */
export async function fetchHNFrontPage(
  minPoints: number = 30,
  relevanceFilter?: { simpleRe: RegExp; ambiguousNames: Set<string>; contextRe: RegExp },
): Promise<HNHit[]> {
  const url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

  if (!res.ok) {
    console.warn(`HN front page fetch failed: ${res.status}`);
    return [];
  }

  const json = await res.json();
  const hits: any[] = json?.hits ?? [];

  const mapped: HNHit[] = hits
    .map((h: any) => ({
      title: h.title,
      url: h.url ?? null,
      points: h.points ?? 0,
      num_comments: h.num_comments ?? 0,
      created_at: h.created_at,
      objectID: h.objectID,
    }))
    .filter((h) => h.points >= minPoints);

  if (!relevanceFilter) return mapped;

  // Two-pass relevance filter
  return mapped.filter((h) => {
    const text = `${h.title} ${h.url ?? ""}`;

    // Pass 1: direct match on unambiguous terms
    if (relevanceFilter.simpleRe.test(text)) return true;

    // Pass 2: ambiguous names need context co-occurrence
    for (const name of relevanceFilter.ambiguousNames) {
      const nameRe = new RegExp(`\\b${name}\\b`, "i");
      if (nameRe.test(text) && relevanceFilter.contextRe.test(text)) return true;
    }

    return false;
  });
}
