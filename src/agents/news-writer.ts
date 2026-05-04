import { extractJson } from "../claude.js";
import { runAgent } from "./runner.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import {
  DigestContentSchema,
  XThreadSchema,
  type DigestContent,
  type CuratedStory,
} from "../models/digest.js";

export interface WriteDigestOpts {
  model?: string;
  revisionFeedback?: { draft: DigestContent; notes: string };
}

/**
 * News Writer agent: generates an X thread from curated stories.
 *
 * On first pass: Claude writes the thread from the curated stories.
 * On revision pass: Claude is given the existing draft + QA notes to revise.
 */
export async function writeDigest(
  stories: CuratedStory[],
  opts?: WriteDigestOpts,
): Promise<DigestContent> {
  const date = new Date().toISOString().slice(0, 10);
  const model = opts?.model ?? "claude-sonnet-4-6";

  const resolvedFormat = resolveFormat(stories.length);

  let prompt: string;

  if (opts?.revisionFeedback) {
    const { draft, notes } = opts.revisionFeedback;
    console.log(`  [writer] revising draft based on QA feedback…`);
    prompt = [
      `Revise the following draft based on QA feedback.`,
      ``,
      `Current draft:`,
      JSON.stringify(draft.x_thread.segments, null, 2),
      ``,
      `QA feedback:`,
      notes,
    ].join("\n");
  } else {
    console.log(`  [writer] generating thread from ${stories.length} stories…`);
    const grassContext = resolveGrassContext();

    // Strip has_visual from stories — writer decides visuals independently
    const storiesForWriter = stories.map(({ has_visual, ...rest }) => rest);

    prompt = [
      `Today: ${date}`,
      ``,
      `Grass context: ${grassContext}`,
      ``,
      `Format: ${resolvedFormat}`,
      ``,
      `Curated stories (${stories.length}):`,
      JSON.stringify(storiesForWriter, null, 2),
    ].join("\n");
  }

  const text = await runAgent({
    agentId: "x-writer",
    prompt,
    skillOverrides: { content: SKILL_PATHS[resolvedFormat] },
    model,
    maxTurns: 8,
  });

  const parsed = JSON.parse(extractJson(text));
  const thread = XThreadSchema.parse(parsed);

  console.log(`  [writer] thread: ${thread.segments.length} tweets`);

  const content: DigestContent = {
    date,
    x_thread: thread,
    generated_at: new Date().toISOString(),
  };

  DigestContentSchema.parse(content);
  return content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const SKILL_PATHS: Record<string, string> = {
  full_digest:     "src/skills/thread-writer.md",
  standard_thread: "src/skills/thread-writer-standard.md",
  short_thread:    "src/skills/thread-writer-short.md",
  single_story:    "src/skills/thread-writer-single.md",
};
