/**
 * Editor agent test.
 *
 * Offline (default): validates that researcher-output.json and editor-output.json
 * conform to their Zod schemas. No LLM calls.
 *
 * Live (--live): runs the editor agent with researcher-output.json as input,
 * validates output shape, saves editor-output.json.
 */
import { editDigest } from "../../src/agents/news-editor.js";
import { NewsItemSchema, EditorialDecisionSchema, type NewsItem } from "../../src/models/digest.js";
import { loadFixture, saveFixture, assertShape, printSummary, LIVE, REVIEW } from "../harness.js";
import { z } from "zod";

const inputFixture = loadFixture<unknown>("researcher-output.json");
const inputItems = assertShape(z.array(NewsItemSchema), inputFixture, "editor input (researcher-output.json)");

if (!LIVE) {
  const outputFixture = loadFixture<unknown>("editor-output.json");
  assertShape(EditorialDecisionSchema, outputFixture, "editor output (editor-output.json)");
  process.exit(0);
}

console.log(`[editor] running live agent with ${inputItems.length} items from fixture…`);
const decision = await editDigest(inputItems as NewsItem[]);
assertShape(EditorialDecisionSchema, decision, `editor → ${decision.stories.length} stories`);
saveFixture("editor-output.json", decision);
if (REVIEW) printSummary("editor decision", decision);
