import { writeFileSync } from "node:fs";
import { extname } from "node:path";

const VALID_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// SVG is excluded — X/Twitter doesn't support SVG uploads

const EXT_MAP: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export interface DownloadResult {
  ok: boolean;
  contentType: string;
  ext: string;
  error?: string;
}

/**
 * Download an image URL to a local file path.
 * Validates that the response is actually an image.
 */
export async function downloadImage(
  url: string,
  outputPath: string,
): Promise<DownloadResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "content-agentsy/1.0" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });

    if (!res.ok) {
      return { ok: false, contentType: "", ext: "", error: `HTTP ${res.status}` };
    }

    const raw = res.headers.get("content-type") ?? "";
    const contentType = raw.split(";")[0].trim().toLowerCase();

    if (!VALID_TYPES.has(contentType)) {
      // Try to infer from URL extension as fallback
      const urlExt = extname(new URL(url).pathname).toLowerCase();
      const inferred = Object.entries(EXT_MAP).find(([, e]) => e === urlExt);
      if (!inferred) {
        return { ok: false, contentType, ext: "", error: `Not an image: ${contentType}` };
      }
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      return { ok: false, contentType, ext: "", error: "Image too small (likely tracking pixel)" };
    }

    // Content-based SVG detection — headers can lie
    const head = buffer.subarray(0, 256).toString("utf-8").trimStart().toLowerCase();
    if (head.startsWith("<svg") || head.startsWith("<?xml") || head.includes("<svg")) {
      return { ok: false, contentType, ext: "", error: "SVG content detected (unsupported by X/Twitter)" };
    }

    const ext = EXT_MAP[contentType] ?? (extname(new URL(url).pathname) || ".png");

    writeFileSync(outputPath, buffer);

    return { ok: true, contentType, ext };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, contentType: "", ext: "", error: message };
  }
}
