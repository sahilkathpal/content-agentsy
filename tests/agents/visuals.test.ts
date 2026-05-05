/**
 * Visuals scout agent test.
 *
 * Offline (default): validates that writer-output.json conforms to DigestContentSchema.
 * No LLM calls, no image downloads.
 *
 * Live (--live): runs the visuals scout with writer-output.json as input,
 * downloads images into tests/fixtures/media/, validates output shape,
 * saves visuals-output.json.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolveVisuals } from "../../src/agents/visuals-scout.js";
import { DigestContentSchema } from "../../src/models/digest.js";
import { loadFixture, saveFixture, assertShape, printSummary, LIVE, REVIEW } from "../harness.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");
const MEDIA_DIR = resolve(FIXTURES_DIR, "media");

const writerFixture = loadFixture<unknown>("writer-output.json");
const content = assertShape(DigestContentSchema, writerFixture, "visuals input (writer-output.json)");

if (!LIVE) {
  process.exit(0);
}

mkdirSync(MEDIA_DIR, { recursive: true });
console.log(`[visuals] running live agent, media → ${MEDIA_DIR}`);
const enriched = await resolveVisuals(content, MEDIA_DIR);
assertShape(DigestContentSchema, enriched, "visuals output");
saveFixture("visuals-output.json", enriched);
if (REVIEW) printSummary("visuals output", enriched);
