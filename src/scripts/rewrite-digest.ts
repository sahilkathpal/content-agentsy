/**
 * Re-run the writer on an existing editorial decision.
 *
 * Usage:
 *   npx tsx src/scripts/rewrite-digest.ts [date]
 *   npx tsx src/scripts/rewrite-digest.ts [date] --thread-only
 *   npx tsx src/scripts/rewrite-digest.ts [date] --model claude-opus-4-6
 *
 * Defaults to today's date. Saves output with timestamp to preserve multiple runs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeDigest } from "../agents/news-writer.js";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const date = positional[0] ?? new Date().toISOString().slice(0, 10);

const threadOnly = args.includes("--thread-only");
const modelIdx = args.indexOf("--model");
const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;

const runDir = resolve(import.meta.dirname, `../../data/runs/digest-${date}`);
const decision = JSON.parse(readFileSync(resolve(runDir, "editorial-decision.json"), "utf-8"));

console.log(`Re-running writer on ${decision.stories.length} stories from ${date}…`);
if (threadOnly) console.log("  (thread-only mode)");
if (model) console.log(`  (model: ${model})`);
console.log();

const content = await writeDigest(decision.stories, { threadOnly, model });

// Save with timestamp to preserve multiple runs
const ts = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const outFile = `digest-content-${ts}.json`;
writeFileSync(resolve(runDir, outFile), JSON.stringify(content, null, 2));
console.log(`\nSaved → ${outFile}`);

// Print thread
console.log(`\n--- Thread (${content.x_thread.segments.length} tweets) ---`);
for (const seg of content.x_thread.segments) {
  console.log(`\nPost ${seg.position} (${seg.text.length} chars):`);
  console.log(seg.text);
}

if (!threadOnly && content.companion_post.body) {
  console.log(`\n--- Companion Post ---`);
  console.log(content.companion_post.body.slice(0, 500) + "…");
}
