import { extractJson } from "../claude.js";
import { runAgent } from "./runner.js";
import { qaMcpServer, QA_TOOL_NAMES } from "../tools/qa-tools.js";
import type { DigestContent, CuratedStory } from "../models/digest.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SegmentNote {
  position: number;
  note: string;
}

interface LlmReview {
  score: number;
  suggestions: string[];
  segment_notes: SegmentNote[];
}

export interface QaResult {
  code_issues: string[];
  llm_review: LlmReview;
  needs_revision: boolean;
  revision_notes: string;
}

// ---------------------------------------------------------------------------
// Format resolver
// ---------------------------------------------------------------------------

function resolveFormat(storyCount: number): string {
  if (storyCount >= 8) return "full_digest";
  if (storyCount >= 4) return "standard_thread";
  if (storyCount >= 2) return "short_thread";
  return "single_story";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * QA agent: Claude calls run_code_checks (mechanical checks) then does
 * editorial review, returning a combined QaResult JSON.
 *
 * needs_revision is true if any code issues exist or the editorial score < 3.
 * revision_notes is a concise, actionable brief for the writer.
 */
export async function reviewDigest(
  content: DigestContent,
  stories: CuratedStory[],
): Promise<QaResult> {
  const format = resolveFormat(stories.length);

  console.log("  [qa] starting agent…");

  const prompt = [
    `Format: ${format}`,
    ``,
    `Thread segments:`,
    JSON.stringify(content.x_thread.segments, null, 2),
    ``,
    `Original curated stories:`,
    JSON.stringify(stories, null, 2),
    ``,
    `DigestContent (for run_code_checks):`,
    JSON.stringify(content, null, 2),
    ``,
    `Call run_code_checks first, then do your editorial review.`,
    ``,
    `Return JSON in this exact shape:`,
    `{`,
    `  "code_issues": [...],`,
    `  "llm_review": {`,
    `    "score": 1-5,`,
    `    "suggestions": [...],`,
    `    "segment_notes": [{"position": N, "note": "..."}]`,
    `  },`,
    `  "needs_revision": true|false,`,
    `  "revision_notes": "..."`,
    `}`,
    ``,
    `Set needs_revision: true if any code_issues exist or llm_review.score < 3.`,
    `Set revision_notes to a specific, actionable brief for the writer covering exactly what needs to change. Empty string if needs_revision is false.`,
  ].join("\n");

  const text = await runAgent({
    agentId: "qa",
    prompt,
    mcpServer: qaMcpServer,
    serverName: "qa-tools",
    toolNames: QA_TOOL_NAMES,
    maxTurns: 5,
  });

  const parsed = JSON.parse(extractJson(text));

  const result: QaResult = {
    code_issues: Array.isArray(parsed.code_issues) ? parsed.code_issues : [],
    llm_review: {
      score: typeof parsed.llm_review?.score === "number" ? parsed.llm_review.score : 3,
      suggestions: Array.isArray(parsed.llm_review?.suggestions) ? parsed.llm_review.suggestions : [],
      segment_notes: Array.isArray(parsed.llm_review?.segment_notes) ? parsed.llm_review.segment_notes : [],
    },
    needs_revision: typeof parsed.needs_revision === "boolean" ? parsed.needs_revision : false,
    revision_notes: typeof parsed.revision_notes === "string" ? parsed.revision_notes : "",
  };

  if (result.code_issues.length > 0) {
    console.log("  [qa] code issues:");
    for (const issue of result.code_issues) console.log(`    - ${issue}`);
  } else {
    console.log("  [qa] code checks passed");
  }

  console.log(`  [qa] LLM score: ${result.llm_review.score}/5`);
  if (result.llm_review.suggestions.length > 0) {
    console.log("  [qa] suggestions:");
    for (const s of result.llm_review.suggestions) console.log(`    - ${s}`);
  }
  if (result.llm_review.segment_notes.length > 0) {
    console.log("  [qa] segment notes:");
    for (const n of result.llm_review.segment_notes) console.log(`    seg-${n.position}: ${n.note}`);
  }

  console.log(`  [qa] needs_revision: ${result.needs_revision}`);
  if (result.needs_revision && result.revision_notes) {
    console.log(`  [qa] revision notes: ${result.revision_notes}`);
  }

  return result;
}
