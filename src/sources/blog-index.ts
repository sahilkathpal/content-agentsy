import { config } from "../config.js";

interface GhostPost {
  title: string;
  slug: string;
  url: string;
  published_at: string;
  meta_description: string | null;
  custom_excerpt: string | null;
}

interface GhostResponse {
  posts: GhostPost[];
}

/**
 * Fetch the published post index from Ghost Content API.
 * Returns a compact markdown list suitable for injection into agent prompts.
 * Returns an empty string if Ghost is not configured.
 */
export async function fetchBlogIndex(): Promise<string> {
  const { ghostUrl, ghostContentKey } = config;
  if (!ghostUrl || !ghostContentKey) return "";

  const base = ghostUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/content/posts/`);
  url.searchParams.set("key", ghostContentKey);
  url.searchParams.set("limit", "all");
  url.searchParams.set("fields", "title,slug,url,published_at,meta_description,custom_excerpt");
  url.searchParams.set("order", "published_at desc");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    console.warn(`  [blog-index] Ghost Content API error: ${res.status} — skipping cross-link context`);
    return "";
  }

  const data = (await res.json()) as GhostResponse;
  const posts = data.posts;

  if (posts.length === 0) return "";

  const lines = posts.map((p) => {
    const excerpt = p.custom_excerpt ?? p.meta_description ?? "";
    return excerpt ? `- [${p.title}](${p.url}) — ${excerpt}` : `- [${p.title}](${p.url})`;
  });

  return lines.join("\n");
}
