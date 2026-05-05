import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../../config.js";

export interface RepoSnapshot {
  repo: string;
  stars: number;
  recorded_at: string;
}

export interface VelocitySpike {
  repo: string;
  stars_yesterday: number;
  stars_today: number;
  delta: number;
  delta_pct: number;
  html_url: string;
  description: string | null;
}

const DEFAULT_SNAPSHOT_PATH = resolve(import.meta.dirname, "../../data/github-snapshots.json");

/**
 * Detect velocity spikes by comparing current star counts against yesterday's snapshot.
 * Flags repos with >100 new stars in 24h OR >5% growth.
 * Writes a new snapshot after comparison.
 */
export async function detectVelocitySpikes(
  repos: string[],
  snapshotPath: string = DEFAULT_SNAPSHOT_PATH,
): Promise<VelocitySpike[]> {
  const previous = loadSnapshot(snapshotPath);
  const previousMap = new Map(previous.map((s) => [s.repo, s]));

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "content-agentsy/1.0",
  };
  if (config.githubToken) {
    headers.Authorization = `Bearer ${config.githubToken}`;
  }

  const results = await Promise.allSettled(
    repos.map(async (repo) => {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status} for ${repo}`);
      const data = await res.json() as {
        stargazers_count: number;
        html_url: string;
        description: string | null;
      };
      return { repo, ...data };
    }),
  );

  const now = new Date().toISOString();
  const currentSnapshots: RepoSnapshot[] = [];
  const spikes: VelocitySpike[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== "fulfilled") {
      console.warn(`  [github-snapshots] ${repos[i]} failed:`, result.reason);
      continue;
    }

    const { repo, stargazers_count, html_url, description } = result.value;
    currentSnapshots.push({ repo, stars: stargazers_count, recorded_at: now });

    const prev = previousMap.get(repo);
    if (!prev) continue; // first run for this repo, no comparison possible

    const delta = stargazers_count - prev.stars;
    const deltaPct = prev.stars > 0 ? (delta / prev.stars) * 100 : 0;

    if (delta > 100 || deltaPct > 5) {
      spikes.push({
        repo,
        stars_yesterday: prev.stars,
        stars_today: stargazers_count,
        delta,
        delta_pct: Math.round(deltaPct * 10) / 10,
        html_url,
        description,
      });
    }
  }

  // Save new snapshot atomically
  saveSnapshot(currentSnapshots, snapshotPath);

  console.log(`  [github-snapshots] ${spikes.length} velocity spikes from ${repos.length} repos`);
  return spikes;
}

function loadSnapshot(path: string): RepoSnapshot[] {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSnapshot(snapshots: RepoSnapshot[], path: string): void {
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(snapshots, null, 2));
  renameSync(tmpPath, path);
}
