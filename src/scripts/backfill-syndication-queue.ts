import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import "dotenv/config";
import { PublisherOutputSchema } from "../models/publisher-output.js";
import { runSyndicationGenerator } from "../agents/syndication-generator.js";
import { enqueue, type SyndicationQueueItem } from "../syndication-queue.js";
import { SyndicationOutputSchema } from "../models/syndication-output.js";
import { writeFileSync } from "node:fs";
import { config } from "../config.js";

const DATA_DIR = resolve(import.meta.dirname, "../../data");
const RUNS_DIR = resolve(DATA_DIR, "runs");

/**
 * Backfill the syndication queue with already-published articles.
 *
 * Scans all run directories for published packets that haven't been
 * syndicated yet, generates syndication assets for each, and enqueues them.
 *
 * Usage: npx tsx src/scripts/backfill-syndication-queue.ts [--dry-run] [--force] [--run <run-id>]
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const runIdx = args.indexOf("--run");
  const runFilter = runIdx !== -1 ? args[runIdx + 1] : null;

  if (dryRun) console.log("[backfill] Dry run — no changes will be made");
  if (force) console.log("[backfill] --force: processing regardless of published status");
  if (runFilter) console.log(`[backfill] --run: filtering to run dirs matching "${runFilter}"`);

  // Find all publisher-output.json files across all runs
  const candidates: Array<{ publisherPath: string; packetDir: string }> = [];

  for (const runEntry of readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (!runEntry.isDirectory()) continue;
    if (runFilter && !runEntry.name.includes(runFilter)) continue;
    const runDir = resolve(RUNS_DIR, runEntry.name);

    for (const entry of readdirSync(runDir, { withFileTypes: true })) {
      // packet-N subdirectory layout
      if (entry.isDirectory() && entry.name.startsWith("packet-")) {
        const packetDir = resolve(runDir, entry.name);
        const publisherPath = resolve(packetDir, "publisher-output.json");
        if (existsSync(publisherPath)) {
          candidates.push({ publisherPath, packetDir });
        }
      }
    }

    // Legacy: root-level publisher-output.json
    const rootPublisher = resolve(runDir, "publisher-output.json");
    if (existsSync(rootPublisher)) {
      candidates.push({ publisherPath: rootPublisher, packetDir: runDir });
    }
  }

  console.log(`[backfill] Found ${candidates.length} total packet(s)`);

  let skippedNotPublished = 0;
  let skippedAlreadySyndicated = 0;
  let skippedMissingFiles = 0;
  let enqueued = 0;
  let failed = 0;

  for (const { publisherPath, packetDir } of candidates) {
    let pub;
    try {
      pub = PublisherOutputSchema.parse(JSON.parse(readFileSync(publisherPath, "utf-8")));
    } catch {
      skippedMissingFiles++;
      continue;
    }

    // Only process published articles (--force bypasses this check)
    if (!force && pub.status !== "published") {
      skippedNotPublished++;
      continue;
    }

    // Skip if already syndicated
    if (existsSync(resolve(packetDir, "syndication-publisher-output.json"))) {
      skippedAlreadySyndicated++;
      continue;
    }

    // Derive paths relative to packetDir (don't trust stored absolute paths)
    const creatorPath = resolve(packetDir, "creator-output.json");
    const runDir = dirname(packetDir.endsWith("/") ? packetDir.slice(0, -1) : packetDir);
    // For root-level packets, runDir === packetDir
    const strategistPath = resolve(
      packetDir === runDir ? packetDir : runDir,
      "strategist-output.json"
    );

    if (!existsSync(creatorPath) || !existsSync(strategistPath)) {
      console.warn(`[backfill] Missing creator or strategist output for ${pub.packet_id} — skipping`);
      skippedMissingFiles++;
      continue;
    }

    // Build canonical URL from slug
    const baseUrl = config.ghostUrl.replace(/\/blog\/ghost\/?$|\/ghost\/?$/, "").replace(/\/+$/, "");
    const canonicalUrl = `${baseUrl}/blog/${pub.ghost_post_slug}/`;

    console.log(`[backfill] Processing: ${pub.packet_id}`);

    if (dryRun) {
      console.log(`  would generate syndication assets and enqueue → ${canonicalUrl}`);
      enqueued++;
      continue;
    }

    try {
      const syndicationOutputPath = resolve(packetDir, "syndication-output.json");

      // Generate if not already done
      let assets;
      if (existsSync(syndicationOutputPath)) {
        console.log(`  syndication-output.json exists — reusing`);
        assets = SyndicationOutputSchema.parse(
          JSON.parse(readFileSync(syndicationOutputPath, "utf-8"))
        ).assets;
      } else {
        assets = await runSyndicationGenerator(creatorPath, strategistPath, pub.packet_id, canonicalUrl);
        const syndicationOutput = SyndicationOutputSchema.parse({
          packet_id: pub.packet_id,
          canonical_slug: pub.ghost_post_slug,
          canonical_url: canonicalUrl,
          assets,
          created_at: new Date().toISOString(),
        });
        writeFileSync(syndicationOutputPath, JSON.stringify(syndicationOutput, null, 2));
      }

      if (assets.length === 0) {
        console.log(`  no syndication targets — skipping`);
        skippedNotPublished++;
        continue;
      }

      enqueue({
        packet_id: pub.packet_id,
        syndication_path: syndicationOutputPath,
        canonical_url: canonicalUrl,
      });

      enqueued++;
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`
[backfill] Done:
  ${enqueued} enqueued
  ${skippedAlreadySyndicated} already syndicated (skipped)
  ${skippedNotPublished} not published / no targets (skipped)
  ${skippedMissingFiles} missing files (skipped)
  ${failed} failed
`);
}

main().catch((err) => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
