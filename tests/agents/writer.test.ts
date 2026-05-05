/**
 * Writer agent test.
 *
 * Offline (default): validates that editor-output.json and writer-output.json
 * conform to their Zod schemas. No LLM calls.
 *
 * Live (--live): runs the writer agent with editor-output.json stories as input,
 * validates output shape, saves writer-output.json.
 */
import { writeDigest } from "../../src/agents/news-writer.js";
import { EditorialDecisionSchema, DigestContentSchema, type CuratedStory } from "../../src/models/digest.js";
import { loadFixture, saveFixture, assertShape, printSummary, LIVE, REVIEW } from "../harness.js";

const editorFixture = loadFixture<unknown>("editor-output.json");
const decision = assertShape(EditorialDecisionSchema, editorFixture, "writer input (editor-output.json)");

if (!LIVE) {
  const outputFixture = loadFixture<unknown>("writer-output.json");
  assertShape(DigestContentSchema, outputFixture, "writer output (writer-output.json)");
  process.exit(0);
}

const stories = decision.stories as CuratedStory[];
console.log(`[writer] running live agent with ${stories.length} stories from fixture…`);
const content = await writeDigest(stories);
assertShape(DigestContentSchema, content, `writer → ${content.x_thread.segments.length} segments`);
saveFixture("writer-output.json", content);
if (REVIEW) printSummary("writer output", content);
