import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";

/**
 * One-time migration: strip unsupported platforms from syndication_targets
 * in all historical strategist-output.json files.
 *
 * Usage: npx tsx src/scripts/fix-syndication-targets.ts [--dry-run]
 */

const RUNS_DIR = resolve(import.meta.dirname, "../../data/runs");
const SUPPORTED_PLATFORMS: string[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../config/syndication-platforms.json"), "utf-8")
);

const dryRun = process.argv.includes("--dry-run");
if (dryRun) console.log("[fix] Dry run — no files will be modified");
console.log(`[fix] Supported platforms: ${SUPPORTED_PLATFORMS.join(", ")}\n`);

let filesChecked = 0;
let filesModified = 0;
let targetsRemoved = 0;

for (const runEntry of readdirSync(RUNS_DIR, { withFileTypes: true })) {
  if (!runEntry.isDirectory()) continue;
  const strategistPath = resolve(RUNS_DIR, runEntry.name, "strategist-output.json");
  if (!existsSync(strategistPath)) continue;

  filesChecked++;
  const raw = JSON.parse(readFileSync(strategistPath, "utf-8"));

  let modified = false;
  for (const packet of raw.ranked_packets ?? []) {
    const before: string[] = packet.syndication_targets ?? [];
    const filtered = before.filter((p: string) => SUPPORTED_PLATFORMS.includes(p));
    const removed = before.filter((p: string) => !SUPPORTED_PLATFORMS.includes(p));

    // If any supported platform is present, fill out the full list
    const after = filtered.length > 0 ? [...SUPPORTED_PLATFORMS] : filtered;
    const added = after.filter((p: string) => !before.includes(p));

    if (removed.length > 0 || added.length > 0) {
      console.log(`  ${runEntry.name} / ${packet.packet_id}`);
      if (removed.length > 0) console.log(`    removed: ${removed.join(", ")}`);
      if (added.length > 0) console.log(`    added:   ${added.join(", ")}`);
      packet.syndication_targets = after;
      targetsRemoved += removed.length;
      modified = true;
    }
  }

  if (modified) {
    filesModified++;
    if (!dryRun) {
      writeFileSync(strategistPath, JSON.stringify(raw, null, 2));
      console.log(`    ✓ written`);
    }
  }
}

console.log(`
[fix] Done:
  ${filesChecked} strategist files checked
  ${filesModified} files with unsupported targets ${dryRun ? "(would be modified)" : "modified"}
  ${targetsRemoved} targets removed
`);
