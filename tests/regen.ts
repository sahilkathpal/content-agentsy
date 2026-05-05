/**
 * Fixture regeneration script. Runs agents in pipeline order and saves outputs
 * as fixtures for downstream tests.
 *
 * Usage:
 *   npx tsx tests/regen.ts                          # regenerate all stages
 *   npx tsx tests/regen.ts --editor --writer --qa   # regenerate from editor forward
 *   npx tsx tests/regen.ts --writer --qa             # regenerate from writer forward
 *
 * Each stage uses the saved fixture from the previous stage as input, unless
 * that stage is also being regenerated. This lets you cascade changes forward
 * from any point in the pipeline without re-running upstream stages.
 *
 * After prompt changes: run this with the affected stage and all downstream
 * stages flagged, then run `npm run test:shapes` to validate all schemas.
 */

import { researchNews } from "../src/agents/news-researcher.js";
import { editDigest } from "../src/agents/news-editor.js";
import { writeDigest } from "../src/agents/news-writer.js";
import { reviewDigest } from "../src/agents/news-qa.js";
import { loadFixture, saveFixture } from "./harness.js";
import { EditorialDecisionSchema, DigestContentSchema, NewsItemSchema, type NewsItem, type CuratedStory, type DigestContent } from "../src/models/digest.js";
import { z } from "zod";

const args = new Set(process.argv.slice(2));
const runAll = args.size === 0;
const run = (stage: string) => runAll || args.has(`--${stage}`);

// ── Researcher ──────────────────────────────────────────────────────────────
let items: NewsItem[];

if (run("researcher")) {
  console.log("\n[regen] researcher…");
  items = await researchNews();
  saveFixture("researcher-output.json", items);
} else {
  const raw = loadFixture<unknown>("researcher-output.json");
  items = z.array(NewsItemSchema).parse(raw);
  console.log(`\n[regen] researcher: loaded ${items.length} items from fixture`);
}

// ── Editor ───────────────────────────────────────────────────────────────────
let decision: z.infer<typeof EditorialDecisionSchema>;

if (run("editor")) {
  console.log("\n[regen] editor…");
  decision = await editDigest(items);
  saveFixture("editor-output.json", decision);
} else {
  const raw = loadFixture<unknown>("editor-output.json");
  decision = EditorialDecisionSchema.parse(raw);
  console.log(`\n[regen] editor: loaded ${decision.stories.length} stories from fixture`);
}

if (!decision.publishable) {
  console.log("\n[regen] editor returned not-publishable — stopping here");
  process.exit(0);
}

// ── Writer ────────────────────────────────────────────────────────────────────
let content: DigestContent;

if (run("writer")) {
  console.log("\n[regen] writer…");
  content = await writeDigest(decision.stories as CuratedStory[]);
  saveFixture("writer-output.json", content);
} else {
  const raw = loadFixture<unknown>("writer-output.json");
  content = DigestContentSchema.parse(raw);
  console.log(`\n[regen] writer: loaded ${content.x_thread.segments.length} segments from fixture`);
}

// ── QA ────────────────────────────────────────────────────────────────────────
if (run("qa")) {
  console.log("\n[regen] qa…");
  const result = await reviewDigest(content, decision.stories as CuratedStory[]);
  saveFixture("qa-output.json", result);
} else {
  console.log("\n[regen] qa: skipped (not flagged)");
}

console.log("\n[regen] done — run `npm run test:shapes` to validate all schemas");
