import { config } from "../config.js";

export interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
  created_at: string;
  topics: string[];
}

const QUERIES = [
  "topic:coding-agent",
  "topic:ai-coding",
  "topic:code-generation language:TypeScript language:Python",
  "topic:mcp-server",
  "topic:autonomous-coding",
];

/**
 * Search GitHub for new and recently-active repos in coding-agent topics.
 *
 * Two strategies:
 * 1. NEW repos (created in the last 30 days) — these are genuinely new projects
 * 2. ACTIVE repos (pushed recently, 500+ stars) — established repos with recent activity
 *
 * The created_at field is passed through so the editor can distinguish
 * "new project" from "old project that got a commit today."
 */
export async function searchGitHubTrending(daysBack: number = 1): Promise<GitHubRepo[]> {
  const since = new Date(Date.now() - daysBack * 86400 * 1000).toISOString().slice(0, 10);
  const newReposSince = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const newRepoQueries = QUERIES.map(async (topic) => {
    // Strategy 1: genuinely NEW repos (created in the last 30 days)
    const params = new URLSearchParams({
      q: `${topic} created:>${newReposSince} stars:>10`,
      sort: "stars",
      order: "desc",
      per_page: "10",
    });
    return fetchGitHubSearch(params, topic);
  });

  const activeRepoQueries = QUERIES.map(async (topic) => {
    // Strategy 2: established repos with recent pushes (higher star floor)
    const params = new URLSearchParams({
      q: `${topic} pushed:>${since} stars:>500`,
      sort: "updated",
      order: "desc",
      per_page: "10",
    });
    return fetchGitHubSearch(params, topic);
  });

  const results = await Promise.allSettled([...newRepoQueries, ...activeRepoQueries]);

  // Deduplicate across all queries by full_name
  const seen = new Map<string, GitHubRepo>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const repo of result.value) {
      if (!seen.has(repo.full_name)) {
        seen.set(repo.full_name, repo);
      }
    }
  }

  return [...seen.values()];
}

async function fetchGitHubSearch(params: URLSearchParams, topic: string): Promise<GitHubRepo[]> {
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?${params}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "content-agentsy/1.0",
          ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!res.ok) {
      console.warn(`GitHub search failed for "${topic}": ${res.status}`);
      return [];
    }

    const json = await res.json();
    const items: any[] = json?.items ?? [];

    return items.map((r: any) => ({
      full_name: r.full_name,
      html_url: r.html_url,
      description: r.description ?? null,
      stargazers_count: r.stargazers_count ?? 0,
      pushed_at: r.pushed_at,
      created_at: r.created_at,
      topics: r.topics ?? [],
    }));
  } catch (err) {
    console.warn(`GitHub search failed for "${topic}":`, err);
    return [];
  }
}
