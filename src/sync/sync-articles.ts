import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, upsertArticle } from "../db/helpers.js";
import { PublisherOutputSchema } from "../models/publisher-output.js";
import "dotenv/config";

/**
 * Sync articles from all run manifest files into SQLite.
 * Scans run dirs and packet subdirs for manifest.json files.
 * Also reads publisher-output.json for confirmed published URLs.
 */
async function main() {
  const db = getDb();
  const runsDir = resolve(import.meta.dirname, "../../data/runs");

  if (!existsSync(runsDir)) {
    console.log("[sync-articles] No data/runs directory found");
    return;
  }

  let synced = 0;
  const runDirs = readdirSync(runsDir).sort();

  for (const run of runDirs) {
    const runPath = resolve(runsDir, run);

    // Check root-level manifest
    const rootManifest = resolve(runPath, "manifest.json");
    synced += processManifest(rootManifest, runPath);

    // Check packet-* subdirs
    try {
      const subs = readdirSync(runPath).filter((s) => s.startsWith("packet-"));
      for (const sub of subs) {
        const packetDir = resolve(runPath, sub);
        const packetManifest = resolve(packetDir, "manifest.json");
        synced += processManifest(packetManifest, packetDir);
      }
    } catch { /* no subdirs */ }
  }

  console.log(`[sync-articles] Synced ${synced} articles`);
  const count = db.prepare("SELECT count(*) as n FROM articles").get() as { n: number };
  console.log(`[sync-articles] Total articles in DB: ${count.n}`);
}

function processManifest(manifestPath: string, dir: string): number {
  if (!existsSync(manifestPath)) return 0;

  let count = 0;
  try {
    const entries = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!Array.isArray(entries)) return 0;

    // Check publisher-output.json — it is authoritative on draft vs published status.
    // If it exists and says "draft", skip the whole manifest (the post hasn't gone live yet).
    // If it says "published", use it as the source of truth for the live URL.
    const publisherPath = resolve(dir, "publisher-output.json");
    let publisherData: ReturnType<typeof PublisherOutputSchema.parse> | null = null;
    if (existsSync(publisherPath)) {
      try {
        const raw = JSON.parse(readFileSync(publisherPath, "utf-8"));
        const parsed = PublisherOutputSchema.parse(raw);
        if (parsed.status !== "published") return 0; // draft — skip entirely
        publisherData = parsed;
      } catch { /* ignore — no publisher output yet, fall through to manifest URL */ }
    }

    for (const entry of entries) {
      // Only sync canonical entries with a confirmed published URL
      let url = entry.published_url;

      // Fall back to publisher output URL (only set when status === "published")
      if (!url && publisherData) {
        url = publisherData.ghost_post_url;
      }

      if (!url || entry.asset_type !== "canonical") continue;

      upsertArticle({
        ...entry,
        published_url: url,
        published_at: entry.published_at ?? new Date().toISOString(),
      });
      count++;
    }
  } catch (err) {
    console.warn(`[sync-articles] Failed to process ${manifestPath}:`, err);
  }

  return count;
}

main().catch((err) => {
  console.error("[sync-articles] Fatal:", err);
  process.exit(1);
});
