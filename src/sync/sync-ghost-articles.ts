import { config } from "../config.js";
import { getDb, slugFromUrl } from "../db/helpers.js";
import "dotenv/config";

/**
 * Sync all published Ghost posts into the articles table.
 * Fills slug, url, title, published_at — pipeline metadata (packet_id, surface_id, etc.)
 * stays null for articles that weren't created by the pipeline.
 *
 * Usage: npx tsx src/sync/sync-ghost-articles.ts
 */
async function main() {
  const { ghostUrl, ghostContentKey } = config;
  if (!ghostUrl || !ghostContentKey) {
    console.error("[sync-ghost-articles] GHOST_URL and GHOST_CONTENT_KEY must be set");
    process.exit(1);
  }

  const base = ghostUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/content/posts/`);
  url.searchParams.set("key", ghostContentKey);
  url.searchParams.set("limit", "all");
  url.searchParams.set("fields", "title,slug,url,published_at");
  url.searchParams.set("order", "published_at desc");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    console.error(`[sync-ghost-articles] Ghost API error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const data = (await res.json()) as { posts: Array<{ title: string; slug: string; url: string; published_at: string }> };
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO articles (slug, url, title, published_at, channel, asset_type)
    VALUES (?, ?, ?, ?, 'blog', 'canonical')
    ON CONFLICT(slug) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      published_at = excluded.published_at
  `);

  const insertAll = db.transaction(() => {
    for (const post of data.posts) {
      upsert.run(post.slug, post.url, post.title, post.published_at);
    }
  });

  insertAll();
  console.log(`[sync-ghost-articles] Synced ${data.posts.length} posts from Ghost`);

  const count = (db.prepare("SELECT count(*) as n FROM articles").get() as { n: number }).n;
  console.log(`[sync-ghost-articles] Total articles in DB: ${count}`);
}

main().catch((err) => {
  console.error("[sync-ghost-articles] Fatal:", err);
  process.exit(1);
});
