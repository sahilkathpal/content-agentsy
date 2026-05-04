/**
 * MCP tool definitions for the QA agent.
 * Provides deterministic code checks so Claude can surface mechanical issues first.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DigestContentSchema, type ThreadSegment } from "../models/digest.js";

// ---------------------------------------------------------------------------
// Format-aware segment count ranges (mirrors news-qa.ts)
// ---------------------------------------------------------------------------

const SEGMENT_RANGES: Record<string, [number, number]> = {
  full_digest:     [8, 15],
  standard_thread: [6, 10],
  short_thread:    [5, 8],
  single_story:    [4, 6],
};

const MIN_ENGAGEMENT_MECHANICS: Record<string, number> = {
  full_digest:     3,
  standard_thread: 3,
  short_thread:    2,
  single_story:    2,
};

const PROHIBITED_WORDS = ["game-changer", "revolutionary", "groundbreaking"];
const THREAD_EMOJI = "\uD83E\uDDF5";

function countEngagementMechanics(segments: ThreadSegment[]): number {
  let count = 0;
  const fullText = segments.map((s) => s.text).join("\n");

  if (/nobody.s talking about|caught me off guard|you won.t believe|one of these/i.test(fullText)) count++;

  for (const seg of segments) {
    if (seg.text.length < 80 && seg.story_index == null && seg.position > 1 && seg.position < segments.length) {
      count++;
      break;
    }
  }

  if (/\d+k?\s*stars|production teams|engineers.*follow/i.test(fullText)) count++;
  if (/sleeping on|shouldn.t be possible|changes the math|didn.t think/i.test(fullText)) count++;

  const closer = segments[segments.length - 1]?.text ?? "";
  if (/\bor\b.*\bwhich\b|\bpick\b/i.test(closer)) count++;
  if (/replaces?\s+\d+|one command|one flag|one line/i.test(fullText)) count++;

  return count;
}

export function runCodeChecks(content: { x_thread: { segments: ThreadSegment[] } }, format: string): string[] {
  const issues: string[] = [];
  const segments = content.x_thread.segments;

  for (const seg of segments) {
    if (seg.text.length > 280) {
      issues.push(`Segment ${seg.position}: ${seg.text.length} chars (max 280)`);
    }
  }

  const range = SEGMENT_RANGES[format] ?? SEGMENT_RANGES.full_digest;
  if (segments.length < range[0]) {
    issues.push(`Thread has ${segments.length} segments (min ${range[0]} for ${format})`);
  }
  if (segments.length > range[1]) {
    issues.push(`Thread has ${segments.length} segments (max ${range[1]} for ${format})`);
  }

  const hook = segments[0]?.text ?? "";
  if (/^(So|Now)\b/i.test(hook)) {
    issues.push(`Hook starts with "${hook.split(/\s/)[0]}" — weak opening`);
  }
  if (hook.includes("Thread") || hook.includes(THREAD_EMOJI)) {
    issues.push(`Hook contains "Thread" or thread emoji — prohibited`);
  }

  const fullText = segments.map((s) => s.text).join(" ");
  for (const word of PROHIBITED_WORDS) {
    if (fullText.toLowerCase().includes(word)) {
      issues.push(`Prohibited word found: "${word}"`);
    }
  }

  const fireCount = (fullText.match(/\uD83D\uDD25/g) ?? []).length;
  if (fireCount > 2) {
    issues.push(`${fireCount} fire emojis (max 2)`);
  }

  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.story_index != null) {
      issues.push("Last segment appears to be a story post, not a closer/CTA");
    }
  }

  const mechanicsCount = countEngagementMechanics(segments);
  const minRequired = MIN_ENGAGEMENT_MECHANICS[format] ?? 3;
  if (mechanicsCount < minRequired) {
    issues.push(`Only ~${mechanicsCount} engagement mechanics detected (min ${minRequired} for ${format})`);
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const runCodeChecksTool = tool(
  "run_code_checks",
  "Run deterministic code checks on the thread: 280-char limit, segment count ranges, hook quality, prohibited words, fire emoji count, engagement mechanics. Call this FIRST before your editorial review. Returns string[] of issues (empty if all pass).",
  {
    content: DigestContentSchema,
    format: z.enum(["full_digest", "standard_thread", "short_thread", "single_story"]),
  },
  async (args) => {
    const issues = runCodeChecks(args.content, args.format);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(issues),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

export const qaMcpServer = createSdkMcpServer({
  name: "qa-tools",
  tools: [runCodeChecksTool],
});

export const QA_TOOL_NAMES = ["run_code_checks"];
