/**
 * Test script: upload media + create Typefully draft with images.
 *
 * Usage:
 *   npx tsx src/scripts/test-publisher.ts [--dry-run]
 *
 * Loads enriched content (with resolved media) from data/test-runs/digest-content-with-media.json
 * and creates a Typefully draft. Run test-visuals-patched first to generate the enriched file.
 * Use --dry-run to skip the actual API calls and just print what would be sent.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { uploadAllMedia, createDraft } from "../tools/typefully.js";
import type { DigestContent } from "../models/digest.js";

const ENRICHED_OUTPUT = resolve(import.meta.dirname, "../../data/test-runs/digest-content-with-media.json");
const FALLBACK_WRITER_OUTPUT = resolve(import.meta.dirname, "../../data/test-runs/writer-output-123700.json");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  // Load enriched content (with media already resolved by visuals scout)
  // Falls back to raw writer output if enriched version doesn't exist
  const inputPath = existsSync(ENRICHED_OUTPUT) ? ENRICHED_OUTPUT : FALLBACK_WRITER_OUTPUT;
  if (!existsSync(inputPath)) {
    console.error(`No input found. Run test-visuals-patched first, or provide writer output at:\n  ${FALLBACK_WRITER_OUTPUT}`);
    process.exit(1);
  }

  const content: DigestContent = JSON.parse(readFileSync(inputPath, "utf-8"));
  console.log(`Loaded ${inputPath === ENRICHED_OUTPUT ? "enriched" : "raw writer"} output: ${content.x_thread.segments.length} segments`);
  if (inputPath !== ENRICHED_OUTPUT) {
    console.warn("⚠ Using raw writer output — media not resolved. Run test-visuals-patched first.");
  }

  const segmentsWithMedia = content.x_thread.segments.filter((s) => s.media);
  console.log(`\nSegments with media: ${segmentsWithMedia.length}`);
  for (const s of segmentsWithMedia) {
    console.log(`  pos ${s.position}: ${s.media!.local_path}`);
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Would upload media and create draft. Exiting.");
    console.log("\nDraft body preview:");
    const posts = content.x_thread.segments.map((s) => ({
      text: s.text.slice(0, 60) + (s.text.length > 60 ? "..." : ""),
      has_media: !!s.media,
    }));
    console.log(JSON.stringify(posts, null, 2));
    return;
  }

  // Upload media
  console.log("\n--- Uploading media ---");
  const mediaMap = await uploadAllMedia(content.x_thread.segments);
  console.log(`\nUploaded ${mediaMap.size} media file(s):`);
  for (const [pos, mediaId] of mediaMap) {
    console.log(`  pos ${pos} → ${mediaId}`);
  }

  // Build segments with media_ids
  const segments = content.x_thread.segments.map((s) => ({
    text: s.text,
    media_id: mediaMap.get(s.position),
  }));

  // Create draft
  console.log("\n--- Creating Typefully draft ---");
  const result = await createDraft(
    segments,
    undefined, // save as draft (no scheduling)
    `Test Draft — ${new Date().toISOString().slice(0, 16)}`,
  );

  console.log("\nResult:");
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== "failed" && result.private_url) {
    console.log(`\nOpen in Typefully: ${result.private_url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
