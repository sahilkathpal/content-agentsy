/**
 * Offline schema validation for all fixtures.
 * No LLM calls. Fast CI-safe check that fixture files still match Zod schemas.
 *
 * Goes stale only when Zod schemas change — not when prompts change.
 */
import { EditorialDecisionSchema, DigestContentSchema, NewsItemSchema } from "../../src/models/digest.js";
import { loadFixture, assertShape } from "../harness.js";
import { z } from "zod";

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

const checks: Array<{ file: string; schema: z.ZodSchema<unknown> }> = [
  { file: "researcher-output.json", schema: z.array(NewsItemSchema) },
  { file: "editor-output.json", schema: EditorialDecisionSchema },
  { file: "writer-output.json", schema: DigestContentSchema },
  { file: "qa-output.json", schema: QaResultSchema },
];

let passed = 0;
let failed = 0;

for (const { file, schema } of checks) {
  try {
    const data = loadFixture<unknown>(file);
    assertShape(schema, data, file);
    passed++;
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENOENT")) {
      console.log(`[SKIP] ${file} — fixture not yet generated`);
    } else {
      failed++;
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
