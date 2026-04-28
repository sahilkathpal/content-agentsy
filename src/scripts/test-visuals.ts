/**
 * Quick test: run the Visuals Scout on an existing digest run.
 * Usage: npx tsx src/scripts/test-visuals.ts
 */

import "dotenv/config";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolveVisuals } from "../agents/visuals-scout.js";
import type { DigestContent } from "../models/digest.js";

const RUN_DIR = resolve(import.meta.dirname, "../../data/runs/digest-2026-04-27");

const content: DigestContent = JSON.parse(
  readFileSync(resolve(RUN_DIR, "digest-content.json"), "utf-8"),
);

const mediaDir = resolve(RUN_DIR, "media");
mkdirSync(mediaDir, { recursive: true });

console.log(`Testing visuals scout on ${content.x_thread.segments.length} segments...\n`);

const result = await resolveVisuals(content, mediaDir);

console.log("\n--- Results ---\n");
for (const seg of result.x_thread.segments) {
  const status = seg.media
    ? `${seg.media.source} → ${seg.media.local_path}`
    : "(no media)";
  console.log(`  seg ${seg.position}: ${status}`);
  console.log(`    text: ${seg.text.slice(0, 80)}...`);
  console.log();
}

const resolved = result.x_thread.segments.filter((s) => s.media).length;
const hinted = result.x_thread.segments.filter((s) => s.visual_hint).length;
const unresolved = result.x_thread.segments.filter((s) => s.visual_hint && !s.media).length;
console.log(`Resolved: ${resolved}/${result.x_thread.segments.length} segments have media`);
console.log(`Hints: ${hinted} segments had visual_hint, ${unresolved} went text-only`);
