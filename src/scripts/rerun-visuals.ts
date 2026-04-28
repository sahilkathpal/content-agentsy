/**
 * Re-run the visuals scout on an existing digest run without
 * re-running researcher, editor, or writer.
 *
 * Usage: npx tsx src/scripts/rerun-visuals.ts [date]
 * Default: today's date
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DigestContentSchema } from "../models/digest.js";
import { resolveVisuals } from "../agents/visuals-scout.js";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const runDir = resolve(import.meta.dirname, `../../data/runs/digest-${date}`);

console.log(`Re-running visuals for digest-${date}`);

const content = DigestContentSchema.parse(
  JSON.parse(readFileSync(resolve(runDir, "digest-content.json"), "utf-8")),
);

// Clear old media
const mediaDir = resolve(runDir, "media");
rmSync(mediaDir, { recursive: true, force: true });
mkdirSync(mediaDir, { recursive: true });

console.log(`\n--- Visuals Scout ---`);
const enriched = await resolveVisuals(content, mediaDir);
writeFileSync(resolve(runDir, "digest-content-with-media.json"), JSON.stringify(enriched, null, 2));

// Summary
let attached = 0;
let skipped = 0;
for (const seg of enriched.x_thread.segments) {
  if (seg.media) {
    attached++;
    console.log(`  seg-${seg.position}: ${seg.media.source} → ${seg.media.local_path.split("/").pop()}`);
  } else {
    skipped++;
  }
}
console.log(`\nDone: ${attached} with media, ${skipped} text-only`);
