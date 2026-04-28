import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import type { DigestContent, CuratedStory, ThreadSegment } from "../models/digest.js";

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
}

// ---------------------------------------------------------------------------
// Format-aware segment count ranges
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

// ---------------------------------------------------------------------------
// Phase 1: Code checks
// ---------------------------------------------------------------------------

const PROHIBITED_WORDS = ["game-changer", "revolutionary", "groundbreaking"];
const THREAD_EMOJI = "\uD83E\uDDF5"; // 🧵

function resolveFormat(storyCount: number): string {
  if (storyCount >= 8) return "full_digest";
  if (storyCount >= 4) return "standard_thread";
  if (storyCount >= 2) return "short_thread";
  return "single_story";
}

function runCodeChecks(content: DigestContent, format: string): string[] {
  const issues: string[] = [];
  const segments = content.x_thread.segments;

  // 280-char limit
  for (const seg of segments) {
    if (seg.text.length > 280) {
      issues.push(`Segment ${seg.position}: ${seg.text.length} chars (max 280)`);
    }
  }

  // Segment count range
  const range = SEGMENT_RANGES[format] ?? SEGMENT_RANGES.full_digest;
  if (segments.length < range[0]) {
    issues.push(`Thread has ${segments.length} segments (min ${range[0]} for ${format})`);
  }
  if (segments.length > range[1]) {
    issues.push(`Thread has ${segments.length} segments (max ${range[1]} for ${format})`);
  }

  // Hook checks
  const hook = segments[0]?.text ?? "";
  if (/^(So|Now)\b/i.test(hook)) {
    issues.push(`Hook starts with "${hook.split(/\s/)[0]}" — weak opening`);
  }
  if (hook.includes("Thread") || hook.includes(THREAD_EMOJI)) {
    issues.push(`Hook contains "Thread" or thread emoji — prohibited`);
  }

  // Prohibited words
  const fullText = segments.map((s) => s.text).join(" ");
  for (const word of PROHIBITED_WORDS) {
    if (fullText.toLowerCase().includes(word)) {
      issues.push(`Prohibited word found: "${word}"`);
    }
  }

  // Fire emoji limit
  const fireCount = (fullText.match(/\uD83D\uDD25/g) ?? []).length;
  if (fireCount > 2) {
    issues.push(`${fireCount} fire emojis (max 2)`);
  }

  // CTA check (last segment)
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.story_index != null) {
      issues.push("Last segment appears to be a story post, not a closer/CTA");
    }
  }

  // Engagement mechanics (heuristic detection)
  const mechanicsCount = countEngagementMechanics(segments);
  const minRequired = MIN_ENGAGEMENT_MECHANICS[format] ?? 3;
  if (mechanicsCount < minRequired) {
    issues.push(`Only ~${mechanicsCount} engagement mechanics detected (min ${minRequired} for ${format})`);
  }

  return issues;
}

/**
 * Heuristic detection of engagement mechanics in thread segments.
 * Not perfect, but catches obvious patterns.
 */
function countEngagementMechanics(segments: ThreadSegment[]): number {
  let count = 0;
  const fullText = segments.map((s) => s.text).join("\n");

  // Curiosity gap: teasing without revealing
  if (/nobody.s talking about|caught me off guard|you won.t believe|one of these/i.test(fullText)) count++;

  // Pattern interrupt: standalone bridge posts
  for (const seg of segments) {
    if (seg.text.length < 80 && seg.story_index == null && seg.position > 1 && seg.position < segments.length) {
      count++;
      break; // count once
    }
  }

  // Social proof: star counts, adoption signals
  if (/\d+k?\s*stars|production teams|engineers.*follow/i.test(fullText)) count++;

  // Contrarian framing
  if (/sleeping on|shouldn.t be possible|changes the math|didn.t think/i.test(fullText)) count++;

  // Reply bait: binary choice in closer
  const closer = segments[segments.length - 1]?.text ?? "";
  if (/\bor\b.*\bwhich\b|\bpick\b/i.test(closer)) count++;

  // Bookmark trigger: specific actionable claims
  if (/replaces?\s+\d+|one command|one flag|one line/i.test(fullText)) count++;

  return count;
}

// ---------------------------------------------------------------------------
// Phase 2: LLM review
// ---------------------------------------------------------------------------

async function runLlmReview(
  content: DigestContent,
  stories: CuratedStory[],
  format: string,
): Promise<LlmReview> {
  const prompt = loadPrompt("news-qa", {
    format,
    thread_json: JSON.stringify(content.x_thread.segments, null, 2),
    stories_json: JSON.stringify(stories, null, 2),
  });

  const text = await callClaude(prompt, "claude-haiku-4-5-20251001", { maxTurns: 1, maxRetries: 1 });
  const parsed = JSON.parse(extractJson(text));

  return {
    score: typeof parsed.score === "number" ? parsed.score : 3,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    segment_notes: Array.isArray(parsed.segment_notes) ? parsed.segment_notes : [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * QA gate for the news digest thread.
 * Phase 1: deterministic code checks (fast).
 * Phase 2: LLM editorial review via Haiku (fast + cheap).
 *
 * Soft gate — logs everything, returns result for the orchestrator to decide.
 */
export async function reviewDigest(
  content: DigestContent,
  stories: CuratedStory[],
): Promise<QaResult> {
  const format = resolveFormat(stories.length);

  // Phase 1
  const codeIssues = runCodeChecks(content, format);
  if (codeIssues.length > 0) {
    console.log(`  [qa] code issues:`);
    for (const issue of codeIssues) console.log(`    - ${issue}`);
  } else {
    console.log("  [qa] code checks passed");
  }

  // Phase 2
  console.log("  [qa] running LLM review…");
  const llmReview = await runLlmReview(content, stories, format);
  console.log(`  [qa] LLM score: ${llmReview.score}/5`);
  if (llmReview.suggestions.length > 0) {
    console.log("  [qa] suggestions:");
    for (const s of llmReview.suggestions) console.log(`    - ${s}`);
  }
  if (llmReview.segment_notes.length > 0) {
    console.log("  [qa] segment notes:");
    for (const n of llmReview.segment_notes) console.log(`    seg-${n.position}: ${n.note}`);
  }

  return { code_issues: codeIssues, llm_review: llmReview };
}
