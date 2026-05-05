/**
 * QA agent test.
 *
 * Offline (default): validates that writer-output.json and qa-output.json
 * conform to their Zod schemas. No LLM calls.
 *
 * Live (--live): runs the QA agent with writer-output.json + editor-output.json,
 * validates output shape, saves qa-output.json.
 */
import { reviewDigest } from "../../src/agents/news-qa.js";
import { EditorialDecisionSchema, DigestContentSchema } from "../../src/models/digest.js";
import { loadFixture, saveFixture, assertShape, printSummary, LIVE, REVIEW } from "../harness.js";
import { z } from "zod";

// QaResult shape (mirrors the interface in news-qa.ts)
const QaResultSchema = z.object({
  code_issues: z.array(z.string()),
  llm_review: z.object({
    score: z.number(),
    suggestions: z.array(z.string()),
    segment_notes: z.array(z.object({ position: z.number(), note: z.string() })),
  }),
  needs_revision: z.boolean(),
  revision_notes: z.string(),
});

const contentFixture = loadFixture<unknown>("writer-output.json");
const content = assertShape(DigestContentSchema, contentFixture, "qa input content (writer-output.json)");

const editorFixture = loadFixture<unknown>("editor-output.json");
const decision = assertShape(EditorialDecisionSchema, editorFixture, "qa input stories (editor-output.json)");

if (!LIVE) {
  const outputFixture = loadFixture<unknown>("qa-output.json");
  assertShape(QaResultSchema, outputFixture, "qa output (qa-output.json)");
  process.exit(0);
}

console.log("[qa] running live agent…");
const result = await reviewDigest(content, decision.stories);
assertShape(QaResultSchema, result, `qa → score ${result.llm_review.score}/5, needs_revision: ${result.needs_revision}`);
saveFixture("qa-output.json", result);
if (REVIEW) printSummary("qa result", result);
