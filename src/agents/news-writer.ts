import { extractJson } from "../claude.js";
import { runAgent } from "./runner.js";
import { buildContextIndex } from "../context/load-context.js";
import { resolve } from "node:path";
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

  let prompt: string;

  if (opts?.revisionFeedback) {
    const { draft, notes } = opts.revisionFeedback;
    console.log(`  [writer] revising draft based on QA feedback…`);
    prompt = [
      `Mode: revision`,
      ``,
      `Current draft:`,
      JSON.stringify(draft.x_thread.segments, null, 2),
      ``,
      `QA feedback:`,
      notes,
    ].join("\n");
  } else {
    console.log(`  [writer] generating thread from ${stories.length} stories…`);
    const contextIndex = buildContextIndex();

    // Strip has_visual from stories — writer decides visuals independently
    const storiesForWriter = stories.map(({ has_visual, ...rest }) => rest);

    prompt = [
      `Today: ${date}`,
      ``,
      contextIndex,
      ``,
      `Curated stories (${stories.length}):`,
      JSON.stringify(storiesForWriter, null, 2),
    ].join("\n");
  }

  const contextDir = resolve(import.meta.dirname, "../../content/pipelines/twitter-news/context");

  const text = await runAgent({
    agentId: "x-writer",
    prompt,
    addDirs: [contextDir],
    ...(opts?.model ? { model: opts.model } : {}),
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

