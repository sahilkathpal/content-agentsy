import { config } from "../config.js";

export interface GitHubRelease {
  repo: string;
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
}

/**
 * Fetch recent releases from the GitHub Releases API for a list of repos.
 * Returns releases published within `maxAgeDays` (default 2).
 */
export async function fetchRecentReleases(
  repos: string[],
  maxAgeDays: number = 2,
): Promise<GitHubRelease[]> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "content-agentsy/1.0",
  };
  if (config.githubToken) {
    headers.Authorization = `Bearer ${config.githubToken}`;
  }

  const results = await Promise.allSettled(
    repos.map(async (repo) => {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=5`;
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 404) return []; // repo has no releases
      if (!res.ok) throw new Error(`GitHub ${res.status} for ${repo}`);

      const data = (await res.json()) as Array<{
        tag_name: string;
        name: string | null;
        body: string | null;
        html_url: string;
        published_at: string;
        prerelease: boolean;
      }>;

      return data
        .filter((r) => {
          const pub = new Date(r.published_at).getTime();
          if (pub < cutoff) return false;
          // Skip prereleases with thin release notes
          if (r.prerelease && (r.body ?? "").length < 200) return false;
          return true;
        })
        .map((r) => ({
          repo,
          tag_name: r.tag_name,
          name: r.name ?? r.tag_name,
          body: (r.body ?? "").slice(0, 1000),
          html_url: r.html_url,
          published_at: r.published_at,
          prerelease: r.prerelease,
        }));
    }),
  );

  const releases: GitHubRelease[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      releases.push(...result.value);
    } else {
      console.warn(`  [github-releases] ${repos[i]} failed:`, result.reason);
    }
  }

  console.log(`  [github-releases] ${releases.length} recent releases from ${repos.length} repos`);
  return releases;
}
