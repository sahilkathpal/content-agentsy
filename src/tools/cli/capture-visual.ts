#!/usr/bin/env npx tsx
/**
 * CLI wrapper for Playwright screenshot capture + post-processing.
 *
 * Usage: npx tsx src/tools/cli/capture-visual.ts <url> <output-path> [--selector SEL] [--scroll-to SEL]
 *
 * Output: JSON result to stdout.
 *   Success: { "ok": true, "finalPath": "...", "contentType": "image/png" }
 *   Failure: { "ok": false, "error": "..." }
 */

import "dotenv/config";
import { captureScreenshot } from "../../tools/playwright-screenshot.js";
import { ensureUploadable } from "../../tools/image-process.js";

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const url = args[0];
const outputPath = args[1];

if (!url || !outputPath) {
  console.error("Usage: capture-visual.ts <url> <output-path> [--selector SEL] [--scroll-to SEL]");
  process.exit(1);
}

const selector = getFlag("--selector");
const scrollTo = getFlag("--scroll-to");

const capture = await captureScreenshot({ url, outputPath, selector, scrollTo });
if (!capture.ok) {
  console.log(JSON.stringify({ ok: false, error: capture.error }));
  process.exit(0);
}

const processed = await ensureUploadable(outputPath);
console.log(JSON.stringify({
  ok: processed.ok,
  finalPath: processed.finalPath,
  contentType: processed.contentType,
  error: processed.error,
}));
