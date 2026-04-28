/**
 * Image post-processing — ensure images meet X/Twitter upload constraints.
 * Resizes oversized images using sharp rather than rejecting them.
 */

import sharp from "sharp";
import { statSync, renameSync, unlinkSync } from "node:fs";

const MAX_STATIC_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_GIF_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_LONG_EDGE = 1600;
const MIN_DIMENSION = 200;

export interface ProcessResult {
  ok: boolean;
  finalPath: string;
  contentType: string;
  ext: string;
  error?: string;
}

/**
 * Ensure an image file meets X/Twitter upload constraints.
 * Resizes and/or re-encodes if needed. May change the file extension
 * (e.g. .png → .jpg) if re-encoding is required.
 *
 * GIFs are left as-is (resizing loses animation) — if over 15MB, rejected.
 */
export async function ensureUploadable(filePath: string): Promise<ProcessResult> {
  const ext = filePath.match(/\.\w+$/)?.[0]?.toLowerCase() ?? ".png";

  // GIFs: can't resize without losing animation, just check size
  if (ext === ".gif") {
    const size = statSync(filePath).size;
    if (size > MAX_GIF_BYTES) {
      return { ok: false, finalPath: filePath, contentType: "image/gif", ext: ".gif", error: `GIF too large: ${(size / 1024 / 1024).toFixed(1)}MB (max 15MB)` };
    }
    return { ok: true, finalPath: filePath, contentType: "image/gif", ext: ".gif" };
  }

  // Check dimensions
  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) {
    return { ok: false, finalPath: filePath, contentType: "", ext, error: "Could not read image dimensions" };
  }

  if (meta.width < MIN_DIMENSION && meta.height < MIN_DIMENSION) {
    return { ok: false, finalPath: filePath, contentType: "", ext, error: `Image too small: ${meta.width}×${meta.height} (min ${MIN_DIMENSION}px)` };
  }

  let size = statSync(filePath).size;
  if (size <= MAX_STATIC_BYTES) {
    const ct = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    return { ok: true, finalPath: filePath, contentType: ct, ext };
  }

  // Resize: longest edge → 1600px
  const longEdge = Math.max(meta.width, meta.height);
  if (longEdge > MAX_LONG_EDGE) {
    const tmpPath = `${filePath}.resized.png`;
    await sharp(filePath)
      .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: "inside" })
      .png()
      .toFile(tmpPath);
    unlinkSync(filePath);
    renameSync(tmpPath, filePath);
    size = statSync(filePath).size;
  }

  if (size <= MAX_STATIC_BYTES) {
    return { ok: true, finalPath: filePath, contentType: "image/png", ext: ".png" };
  }

  // Still too large — convert to JPEG
  const jpgPath = filePath.replace(/\.\w+$/, ".jpg");
  await sharp(filePath)
    .jpeg({ quality: 90 })
    .toFile(jpgPath);

  if (jpgPath !== filePath) {
    try { unlinkSync(filePath); } catch {}
  }

  size = statSync(jpgPath).size;
  if (size > MAX_STATIC_BYTES) {
    return { ok: false, finalPath: jpgPath, contentType: "image/jpeg", ext: ".jpg", error: `Still too large after JPEG conversion: ${(size / 1024 / 1024).toFixed(1)}MB` };
  }

  return { ok: true, finalPath: jpgPath, contentType: "image/jpeg", ext: ".jpg" };
}
