#!/usr/bin/env npx tsx
/**
 * CLI wrapper for image download + post-processing.
 *
 * Usage: npx tsx src/tools/cli/download-image.ts <image-url> <output-path>
 *
 * Output: JSON result to stdout.
 *   Success: { "ok": true, "finalPath": "...", "contentType": "image/jpeg", "ext": ".jpg" }
 *   Failure: { "ok": false, "error": "..." }
 */

import "dotenv/config";
import { renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { downloadImage } from "../../tools/image-download.js";
import { ensureUploadable } from "../../tools/image-process.js";

const [, , imageUrl, outputPath] = process.argv;

if (!imageUrl || !outputPath) {
  console.error("Usage: download-image.ts <image-url> <output-path>");
  process.exit(1);
}

const tmpPath = `${outputPath}-tmp`;
const dl = await downloadImage(imageUrl, tmpPath);
if (!dl.ok) {
  console.log(JSON.stringify({ ok: false, error: dl.error }));
  process.exit(0);
}

// Strip any existing extension to avoid double extensions (e.g. seg-4.png.jpg)
const stem = join(dirname(outputPath), basename(outputPath).replace(/\.\w+$/, ""));
const finalDl = `${stem}${dl.ext}`;
renameSync(tmpPath, finalDl);

const processed = await ensureUploadable(finalDl);
console.log(JSON.stringify({
  ok: processed.ok,
  finalPath: processed.finalPath,
  contentType: processed.contentType,
  ext: processed.ext,
  error: processed.error,
}));
