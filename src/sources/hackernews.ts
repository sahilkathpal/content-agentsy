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
