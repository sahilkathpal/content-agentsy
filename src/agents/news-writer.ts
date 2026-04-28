import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import {
  DigestContentSchema,
  XThreadSchema,
  CompanionPostSchema,
  type DigestContent,
  type CuratedStory,
  type ThreadSegment,
} from "../models/digest.js";

export interface WriteDigestOpts {
  model?: string;
  threadOnly?: boolean;
}

/**
 * News Writer agent: generates an X thread and Ghost companion post
 * from curated stories, with Grass brand context.
 *
 * Two-pass architecture:
 *   Pass 1 — Thread (voice-heavy, skill file auto-loaded by Claude Code)
 *   Pass 2 — Companion post (derivative, source links for Ghost blog)
 */
export async function writeDigest(
  stories: CuratedStory[],
  opts?: WriteDigestOpts,
): Promise<DigestContent> {
  const date = new Date().toISOString().slice(0, 10);
  const model = opts?.model ?? "claude-sonnet-4-6";

  console.log(`  [writer] generating thread from ${stories.length} stories…`);

  const grassContext = resolveGrassContext();
  const resolvedFormat = resolveFormat(stories.length);

  // --- Pass 1: Thread ---
  const thread = await generateThread(stories, {
    date,
    grassContext,
    format: resolvedFormat,
    model,
  });

  // Enforce 280-char ceiling
  const trimmedSegments = await trimOverlengthSegments(thread.segments, model);
  thread.segments = trimmedSegments;
  thread.hook = trimmedSegments[0].text;
  thread.cta = trimmedSegments[trimmedSegments.length - 1].text;

  console.log(`  [writer] thread: ${thread.segments.length} tweets`);

  if (opts?.threadOnly) {
    return {
      date,
      x_thread: thread,
      companion_post: { title: "", body: "" },
      generated_at: new Date().toISOString(),
    };
  }

  // --- Pass 2: Companion post ---
  console.log(`  [writer] generating companion post…`);
  const companion = await generateCompanion(stories, thread, {
    date,
    model,
  });

  console.log(`  [writer] companion: "${companion.title}"`);

  const content: DigestContent = {
    date,
    x_thread: thread,
    companion_post: companion,
    generated_at: new Date().toISOString(),
  };

  DigestContentSchema.parse(content);
  return content;
}

// ---------------------------------------------------------------------------
// Pass 1: Thread generation
// ---------------------------------------------------------------------------

async function generateThread(
  stories: CuratedStory[],
  ctx: { date: string; grassContext: string; format: string; model: string },
) {
  // Strip has_visual from stories — writer decides visuals independently
  const storiesForWriter = stories.map(({ has_visual, ...rest }) => rest);

  const prompt = loadPrompt("news-writer-thread", {
    date: ctx.date,
    grass_context: ctx.grassContext,
    format: ctx.format,
    skill_name: formatToSkill(ctx.format),
    stories_count: String(stories.length),
    stories_json: JSON.stringify(storiesForWriter, null, 2),
  });

  const text = await callClaude(prompt, ctx.model, { maxTurns: 3 });
  const parsed = JSON.parse(extractJson(text));
  return XThreadSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Pass 2: Companion post generation
// ---------------------------------------------------------------------------

export async function generateCompanion(
  stories: CuratedStory[],
  thread: { segments: ThreadSegment[] },
  ctx: { date: string; model: string },
) {
  const prompt = loadPrompt("news-writer-companion", {
    date: ctx.date,
    thread_json: JSON.stringify(thread.segments, null, 2),
    stories_json: JSON.stringify(stories, null, 2),
  });

  const text = await callClaude(prompt, ctx.model, { maxTurns: 3 });
  const parsed = JSON.parse(extractJson(text));
  return CompanionPostSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// 280-char enforcement
// ---------------------------------------------------------------------------

async function trimOverlengthSegments(
  segments: ThreadSegment[],
  model: string,
): Promise<ThreadSegment[]> {
  const overLength = segments.filter((s) => s.text.length > 280);
  if (overLength.length === 0) return segments;

  console.log(`  [writer] ${overLength.length} tweets over 280 chars — trimming…`);

  const trimPrompt = `These tweets exceed the 280-character limit for X. Shorten each one to ≤ 275 characters while preserving the meaning and voice. Return ONLY a JSON array of objects with "position" and "text" fields.\n\n${JSON.stringify(overLength.map((s) => ({ position: s.position, text: s.text, length: s.text.length })), null, 2)}`;

  const trimText = await callClaude(trimPrompt, model, { maxTurns: 1 });
  const trimmed: Array<{ position: number; text: string }> = JSON.parse(extractJson(trimText));

  for (const fix of trimmed) {
    const seg = segments.find((s) => s.position === fix.position);
    if (seg && fix.text.length <= 280) {
      seg.text = fix.text;
    }
  }

  const stillOver = segments.filter((s) => s.text.length > 280);
  if (stillOver.length > 0) {
    throw new Error(
      `${stillOver.length} tweets still exceed 280 chars after trimming: positions ${stillOver.map((s) => s.position).join(", ")}`,
    );
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatToSkill(format: string): string {
  switch (format) {
    case "full_digest": return "thread-writer";
    case "standard_thread": return "thread-writer-standard";
    case "short_thread": return "thread-writer-short";
    case "single_story": return "thread-writer-single";
    default: return "thread-writer";
  }
}

function resolveGrassContext(): string {
  try {
    return buildContextString(loadContextForConsumer("derivatives"));
  } catch {
    return "Grass is a VM-first compute platform for developers. Website: codeongrass.com";
  }
}

function resolveFormat(count: number): string {
  if (count >= 8) return "full_digest";
  if (count >= 4) return "standard_thread";
  if (count >= 2) return "short_thread";
  return "single_story";
}
