/**
 * Lightweight visual pre-scan: checks if story URLs have images available
 * without downloading them. Used before the writer stage so it knows
 * which stories are worth attaching visuals to.
 *
 * For GitHub repos: fetches the raw README and checks for image patterns.
 * For non-GitHub URLs: returns null (unknown).
 */

import { parseGitHubUrl } from "../agents/visuals-scout.js";
import type { CuratedStory } from "../models/digest.js";

const IMAGE_PATTERNS = /!\[|<img\s|\.png|\.gif|\.jpg|\.jpeg|\.webp/i;

// Patterns that indicate decorative/badge images, not real visuals
const BADGE_ONLY_PATTERN = /^(?:(?!\[.*?\]\(.*?(?:screenshot|demo|diagram|architecture|banner|preview|example).*?\))[\s\S])*$/i;

/**
 * Check if a GitHub repo README contains real images (not just badges).
 * Returns true if images found, false if no images, null on fetch failure.
 */
async function checkGitHubReadme(
  owner: string,
  repo: string,
): Promise<boolean | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "content-agentsy/1.0" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const text = await res.text();

    if (!IMAGE_PATTERNS.test(text)) return false;

    // Check if all images are just badges (shields.io, github actions, etc.)
    const imageRefs = text.match(/!\[.*?\]\(.*?\)|<img\s[^>]*src=["'][^"']+["']/gi) ?? [];
    const badgeDomains = ["shields.io", "badge", "github.com/workflows", "img.shields", "codecov.io", "travis-ci"];
    const nonBadgeImages = imageRefs.filter(
      (ref) => !badgeDomains.some((d) => ref.toLowerCase().includes(d)),
    );

    return nonBadgeImages.length > 0;
  } catch {
    return null;
  }
}

/**
 * Pre-scan all curated stories for visual availability.
 * Returns a Map from story rank to:
 *   true  — images confirmed available
 *   false — no images found
 *   null  — unable to determine (non-GitHub URL or fetch failure)
 */
export async function prescanVisuals(
  stories: CuratedStory[],
): Promise<Map<number, boolean | null>> {
  const results = new Map<number, boolean | null>();

  const checks = stories.map(async (story) => {
    // Try the story URL first, then project_url as fallback
    const urlsToCheck = [story.url, story.project_url].filter(Boolean) as string[];

    for (const url of urlsToCheck) {
      const gh = parseGitHubUrl(url);
      if (gh) {
        const has = await checkGitHubReadme(gh.owner, gh.repo);
        if (has !== null) {
          results.set(story.rank, has);
          return;
        }
      }
    }

    // Non-GitHub or all fetches failed → unknown
    results.set(story.rank, null);
  });

  await Promise.allSettled(checks);
  return results;
}
