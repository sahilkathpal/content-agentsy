import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { requireKey } from "../config.js";

interface GhostPost {
  title: string;
  slug: string;
  url: string;
  published_at: string;
  meta_description: string | null;
  custom_excerpt: string | null;
  html: string | null;
}

interface GhostResponse {
  posts: GhostPost[];
  meta: { pagination: { total: number } };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function fetchAllPosts(ghostUrl: string, contentKey: string): Promise<GhostPost[]> {
  const base = ghostUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/content/posts/`);
  url.searchParams.set("key", contentKey);
  url.searchParams.set("limit", "all");
  url.searchParams.set("fields", "title,slug,url,published_at,meta_description,custom_excerpt,html");
  url.searchParams.set("order", "published_at desc");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Ghost Content API error: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as GhostResponse;
  return data.posts;
}

function buildLlmsTxt(posts: GhostPost[], siteUrl: string): string {
  const lines = [
    `# Grass`,
    `> Content factory articles`,
    ``,
    `## Articles`,
    ``,
    ...posts.map((p) => `- [${p.title}](${p.url})`),
  ];
  return lines.join("\n") + "\n";
}

function buildLlmsFullTxt(posts: GhostPost[]): string {
  const sections = posts.map((p) => {
    const body = p.html ? stripHtml(p.html) : "";
    return `# ${p.title}\nURL: ${p.url}\n\n${body}\n\n---`;
  });
  return sections.join("\n\n") + "\n";
}

async function main() {
  const ghostUrl = requireKey("ghostUrl");
  const contentKey = requireKey("ghostContentKey");
  const outputDir = requireKey("llmsOutputDir");

  console.log(`Fetching posts from ${ghostUrl}...`);
  const posts = await fetchAllPosts(ghostUrl, contentKey);
  console.log(`Fetched ${posts.length} published posts`);

  mkdirSync(outputDir, { recursive: true });

  const llmsTxt = buildLlmsTxt(posts, ghostUrl);
  writeFileSync(join(outputDir, "llms.txt"), llmsTxt, "utf8");
  console.log(`Written llms.txt (${llmsTxt.length} bytes)`);

  const llmsFullTxt = buildLlmsFullTxt(posts);
  writeFileSync(join(outputDir, "llms-full.txt"), llmsFullTxt, "utf8");
  console.log(`Written llms-full.txt (${llmsFullTxt.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
