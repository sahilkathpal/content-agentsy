#!/usr/bin/env npx tsx
/**
 * CLI wrapper for Parallel visual candidate search.
 *
 * Usage: npx tsx src/tools/cli/browse-url.ts <url> <hint-json>
 *   hint-json: JSON string with { description, image_type, product_name }
 *
 * Output: JSON array of visual candidates to stdout.
 */

import "dotenv/config";
import { findVisualCandidates } from "../../tools/parallel-visual.js";
import type { VisualHint } from "../../models/digest.js";

const [, , url, hintJson] = process.argv;

if (!url || !hintJson) {
  console.error("Usage: browse-url.ts <url> <hint-json>");
  process.exit(1);
}

const hint: VisualHint = JSON.parse(hintJson);
const candidates = await findVisualCandidates(url, hint);
console.log(JSON.stringify(candidates, null, 2));
