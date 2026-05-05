/**
 * Researcher agent test.
 *
 * Offline (default): no test — researcher has no fixture input to validate against.
 * Live (--live): runs the agent, validates NewsItem[] shape, saves output as fixture.
 */
import { researchNews } from "../../src/agents/news-researcher.js";
import { NewsItemSchema } from "../../src/models/digest.js";
import { assertShape, saveFixture, printSummary, LIVE, REVIEW } from "../harness.js";
import { z } from "zod";

if (!LIVE) {
  console.log("[researcher] pass --live to run the agent");
  process.exit(0);
}

console.log("[researcher] running live agent…");
const items = await researchNews();
assertShape(z.array(NewsItemSchema), items, `researcher → ${items.length} items`);
saveFixture("researcher-output.json", items);
if (REVIEW) printSummary("researcher output", items);
