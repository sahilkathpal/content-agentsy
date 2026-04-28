/**
 * Visuals Scout v4 — agentic Claude Code call that resolves visual_hint
 * directives in thread segments to actual image files.
 *
 * Instead of a rigid pipeline, this spawns a Claude subprocess with
 * Bash + Read tools. The subprocess can browse URLs (via Parallel),
 * download images, capture screenshots, and inspect results — adapting
 * its strategy based on what it finds.
 */

import { mkdirSync } from "node:fs";
import type { DigestContent, ResolvedMedia } from "../models/digest.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";

// ---------------------------------------------------------------------------
// GitHub URL parsing (exported — used by visual-prescan.ts)
// ---------------------------------------------------------------------------

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ScoutResult {
  position: number;
  local_path: string;
  source: ResolvedMedia["source"];
  alt: string;
  content_type: string;
}

function parseScoutResponse(text: string): ScoutResult[] {
  try {
    const json = JSON.parse(extractJson(text));
    const resolved = json.resolved ?? json;
    if (!Array.isArray(resolved)) return [];
    return resolved.filter(
      (r: Record<string, unknown>) =>
        typeof r.position === "number" &&
        typeof r.local_path === "string" &&
        typeof r.source === "string",
    );
  } catch (err) {
    console.warn(`  [visuals] Failed to parse scout response: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolve visual_hint directives in thread segments to actual images.
 * Spawns a Claude Code subprocess that autonomously finds and captures visuals.
 * Mutates and returns the content with media fields populated.
 */
export async function resolveVisuals(
  content: DigestContent,
  mediaDir: string,
): Promise<DigestContent> {
  mkdirSync(mediaDir, { recursive: true });

  const segments = content.x_thread.segments;
  const hintedSegments = segments.filter((s) => s.visual_hint && (s.visual_hint.candidate_urls?.length ?? 0) > 0);

  if (hintedSegments.length === 0) {
    console.log("  [visuals] No segments with visual hints, skipping");
    return content;
  }

  console.log(`  [visuals] Resolving visuals for ${hintedSegments.length} segment(s) via agentic scout...`);

  // Build the segments payload — only segments with hints
  const segmentsForPrompt = hintedSegments.map((s) => ({
    position: s.position,
    text: s.text.slice(0, 120) + (s.text.length > 120 ? "..." : ""),
    visual_hint: s.visual_hint,
  }));

  const prompt = loadPrompt("visuals-scout", {
    segments_json: JSON.stringify(segmentsForPrompt, null, 2),
    media_dir: mediaDir,
  });

  const response = await callClaude(prompt, "claude-sonnet-4-6", {
    maxTurns: hintedSegments.length * 6 + 2,
    maxRetries: 1,
    allowedTools: ["Bash", "Read"],
    addDirs: [mediaDir],
  });

  // Parse the scout's output and populate segment.media fields
  const results = parseScoutResponse(response);

  for (const result of results) {
    const segment = segments.find((s) => s.position === result.position);
    if (!segment) {
      console.warn(`  [visuals] Scout returned position ${result.position} but no matching segment`);
      continue;
    }

    segment.media = {
      local_path: result.local_path,
      source: result.source,
      alt: result.alt,
      content_type: result.content_type,
    };
    console.log(`  [visuals] seg-${result.position}: resolved → ${result.local_path}`);
  }

  const resolved = segments.filter((s) => s.media).length;
  console.log(`  [visuals] Done: ${resolved}/${hintedSegments.length} segments resolved with media`);

  return content;
}
