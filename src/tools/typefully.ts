import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { requireKey } from "../config.js";
import type { ThreadSegment as DigestThreadSegment } from "../models/digest.js";
import type { NativeUnit } from "../models/derivatives-output.js";
import type { NativePlatformResult } from "../models/native-publisher-output.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ThreadSegment {
  text: string;
  media_id?: string;
}

export interface TypefullyResult {
  draft_id: string | null;
  private_url: string | null;
  scheduled_at: string | null;
  status: "scheduled" | "published" | "draft" | "failed";
  error: string | null;
}

// ---------------------------------------------------------------------------
// Retry wrapper — handles 429 rate limits with backoff
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });

    if (response.status !== 429) return response;

    if (attempt === maxRetries) return response; // return the 429 on last attempt

    // Parse retry delay from headers, fall back to exponential backoff
    const resetHeader = response.headers.get("X-RateLimit-User-Reset")
      ?? response.headers.get("X-RateLimit-SocialSet-Reset");
    let delayMs: number;
    if (resetHeader) {
      const resetAt = Number(resetHeader) * 1000; // Unix timestamp → ms
      delayMs = Math.max(resetAt - Date.now(), 1000);
    } else {
      delayMs = 1000 * 2 ** attempt; // 1s, 2s, 4s
    }

    console.warn(`  [typefully] rate limited, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw lastError ?? new Error("fetchWithRetry: unexpected fall-through");
}

// ---------------------------------------------------------------------------
// Media upload — presigned S3 flow
// ---------------------------------------------------------------------------

/**
 * Upload a local file to Typefully via their presigned S3 flow.
 *
 * 1. POST /media/upload → { media_id, upload_url }
 * 2. PUT raw bytes to upload_url (no extra headers!)
 * 3. Poll GET /media/{media_id} until status === "ready"
 *
 * Returns the media_id on success, null on failure.
 */
export async function uploadMedia(localPath: string): Promise<string | null> {
  const apiKey = requireKey("typefullyApiKey");
  const socialSetId = requireKey("typefullySocialSetId");
  const fileName = basename(localPath);

  try {
    // Step 1: Get presigned upload URL
    const uploadRes = await fetchWithRetry(
      `https://api.typefully.com/v2/social-sets/${socialSetId}/media/upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file_name: fileName }),
      },
    );

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`media/upload ${uploadRes.status}: ${text}`);
    }

    const { media_id, upload_url } = await uploadRes.json() as {
      media_id: string;
      upload_url: string;
    };

    console.log(`  [typefully] media upload initiated: ${fileName} → ${media_id}`);

    // Step 2: PUT raw bytes to presigned S3 URL — NO extra headers
    const fileBytes = readFileSync(localPath);
    const putRes = await fetch(upload_url, {
      method: "PUT",
      body: fileBytes,
      signal: AbortSignal.timeout(60_000),
    });

    if (!putRes.ok && putRes.status !== 204) {
      const text = await putRes.text();
      throw new Error(`S3 PUT ${putRes.status}: ${text}`);
    }

    // Step 3: Poll until ready (max ~30s)
    const mediaId = await pollMediaStatus(apiKey, socialSetId, media_id);
    return mediaId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [typefully] media upload failed for ${fileName}: ${message}`);
    return null;
  }
}

async function pollMediaStatus(
  apiKey: string,
  socialSetId: string,
  mediaId: string,
  maxWaitMs = 30_000,
  intervalMs = 2_000,
): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const res = await fetchWithRetry(
      `https://api.typefully.com/v2/social-sets/${socialSetId}/media/${mediaId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    if (!res.ok) {
      console.warn(`  [typefully] media status poll ${res.status} for ${mediaId}`);
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const data = await res.json() as { status: string; error_reason?: string };

    if (data.status === "ready") {
      console.log(`  [typefully] media ready: ${mediaId}`);
      return mediaId;
    }

    if (data.status === "failed") {
      console.error(`  [typefully] media processing failed: ${data.error_reason ?? "unknown"}`);
      return null;
    }

    // Still processing — wait and retry
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.error(`  [typefully] media poll timed out after ${maxWaitMs / 1000}s for ${mediaId}`);
  return null;
}

/**
 * Upload media for all segments that have resolved media.
 * Returns a Map of segment position → Typefully media_id.
 * Segments without media are skipped.
 */
export async function uploadAllMedia(
  segments: DigestThreadSegment[],
): Promise<Map<number, string>> {
  const mediaMap = new Map<number, string>();

  const uploads = segments
    .filter((s) => s.media?.local_path)
    .map(async (s) => {
      const mediaId = await uploadMedia(s.media!.local_path);
      if (mediaId) {
        mediaMap.set(s.position, mediaId);
      }
    });

  await Promise.all(uploads);
  return mediaMap;
}

// ---------------------------------------------------------------------------
// Draft creation — daily-news workflow (X thread + companion reply)
// ---------------------------------------------------------------------------

/**
 * Create a Typefully draft from thread segments.
 *
 * @param segments - Array of tweet texts forming the thread
 * @param publishAt - "now", "next-free-slot", ISO 8601 datetime, or undefined (save as draft).
 * @param draftTitle - Optional internal title for the draft in Typefully UI.
 */
export async function createDraft(
  segments: ThreadSegment[],
  publishAt?: string,
  draftTitle?: string,
): Promise<TypefullyResult> {
  const apiKey = requireKey("typefullyApiKey");
  const socialSetId = requireKey("typefullySocialSetId");

  // Build the posts array: thread tweets + companion reply with source links
  const posts = segments.map((s) => {
    const post: Record<string, unknown> = { text: s.text };
    if (s.media_id) {
      post.media_ids = [s.media_id];
    }
    return post;
  });

  // Companion post is for Ghost blog, not X — don't append to thread.

  const body: Record<string, unknown> = {
    platforms: {
      x: {
        enabled: true,
        posts,
      },
    },
  };

  if (publishAt) {
    body.publish_at = publishAt;
  }
  if (draftTitle) {
    body.draft_title = draftTitle;
  }

  try {
    const response = await fetchWithRetry(
      `https://api.typefully.com/v2/social-sets/${socialSetId}/drafts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Typefully API ${response.status}: ${text}`);
    }

    const data = await response.json() as Record<string, unknown>;

    let status: TypefullyResult["status"];
    if (publishAt === "now") status = "published";
    else if (publishAt) status = "scheduled";
    else status = "draft";

    return {
      draft_id: String(data.id ?? ""),
      private_url: data.private_url ? String(data.private_url) : null,
      scheduled_at: data.scheduled_date ? String(data.scheduled_date) : null,
      status,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [typefully] draft creation failed: ${message}`);
    return {
      draft_id: null,
      private_url: null,
      scheduled_at: null,
      status: "failed",
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Native draft creation — main pipeline (X thread + LinkedIn post)
// ---------------------------------------------------------------------------

/**
 * Create a Typefully draft from pipeline native units (X thread + LinkedIn post).
 *
 * Saves as draft only (no publish_at) — manual review in Typefully UI.
 * Uses the v2 multi-platform endpoint to create one draft with both platforms.
 */
export async function createNativeDraft(
  units: NativeUnit[],
): Promise<NativePlatformResult[]> {
  const apiKey = requireKey("typefullyApiKey");
  const socialSetId = requireKey("typefullySocialSetId");

  const xThread = units.find((u) => u.platform === "x_twitter");
  const linkedIn = units.find((u) => u.platform === "linkedin");

  if (!xThread && !linkedIn) {
    return [];
  }

  const platforms: Record<string, { enabled: boolean; posts: Array<{ text: string }> }> = {};

  if (xThread) {
    platforms.x = {
      enabled: true,
      posts: xThread.segments
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ text: s.text })),
    };
  }

  if (linkedIn) {
    platforms.linkedin = {
      enabled: true,
      posts: [{ text: linkedIn.text }],
    };
  }

  // No publish_at — saves as draft for manual review
  const body = { platforms };

  try {
    const response = await fetchWithRetry(
      `https://api.typefully.com/v2/social-sets/${socialSetId}/drafts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Typefully API ${response.status}: ${text}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const draftId = String(data.id ?? "");
    const draftUrl = data.private_url ? String(data.private_url) : null;

    const results: NativePlatformResult[] = [];

    if (xThread) {
      results.push({
        platform: "x",
        status: "drafted",
        draft_id: draftId,
        draft_url: draftUrl,
        error: null,
      });
    }

    if (linkedIn) {
      results.push({
        platform: "linkedin",
        status: "drafted",
        draft_id: draftId,
        draft_url: draftUrl,
        error: null,
      });
    }

    return results;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [typefully] native draft creation failed: ${message}`);

    const results: NativePlatformResult[] = [];
    if (xThread) {
      results.push({ platform: "x", status: "failed", draft_id: null, draft_url: null, error: message });
    }
    if (linkedIn) {
      results.push({ platform: "linkedin", status: "failed", draft_id: null, draft_url: null, error: message });
    }
    return results;
  }
}
