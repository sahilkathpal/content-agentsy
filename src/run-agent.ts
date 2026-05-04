/**
 * run-agent.ts — TypeScript dispatcher for individual agent invocations.
 *
 * Called by scripts/run-agent.sh via env vars:
 *   AGENT_ID       — agent to run (researcher, editor, x-writer, visuals-scout, publisher)
 *   AGENT_RUN_DIR  — path to the run directory (e.g. data/runs/twitter-news-thread-2026-05-04)
 *   AGENT_STAGE    — stage subdirectory name (e.g. research, edit, write)
 *   AGENT_PUBLISH  — "true" if publisher should actually post (default: false)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateConfig } from "./config.js";
import { researchNews } from "./agents/news-researcher.js";
import { editDigest } from "./agents/news-editor.js";
import { writeDigest } from "./agents/news-writer.js";
import { resolveVisuals } from "./agents/visuals-scout.js";
import { reviewDigest, type QaResult } from "./agents/news-qa.js";
import { createDraft, uploadAllMedia } from "./tools/typefully.js";
import { normalizeUrl, loadLedger, saveLedger } from "./ledger.js";
import type {
  NewsItem,
  CuratedStory,
  EditorialDecision,
  DigestContent,
} from "./models/digest.js";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const AGENT_ID = process.env.AGENT_ID ?? "";
const RUN_DIR = process.env.AGENT_RUN_DIR ?? "";
const STAGE = process.env.AGENT_STAGE ?? "";


if (!AGENT_ID || !RUN_DIR || !STAGE) {
  console.error(
    "Missing required env vars: AGENT_ID, AGENT_RUN_DIR, AGENT_STAGE",
  );
  console.error(
    "These are set by scripts/run-agent.sh — do not invoke this file directly.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const stageDir = resolve(RUN_DIR, STAGE);

function inputPath(): string {
  return resolve(stageDir, "input.json");
}

function outputPath(): string {
  return resolve(stageDir, "output.json");
}

function nextInputPath(nextStage: string): string {
  return resolve(RUN_DIR, nextStage, "input.json");
}

function readInput<T>(): T {
  const p = inputPath();
  if (!existsSync(p)) {
    throw new Error(`Input file not found: ${p}`);
  }
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function readStageOutput<T>(stage: string): T {
  const p = resolve(RUN_DIR, stage, "output.json");
  if (!existsSync(p)) {
    throw new Error(`Stage output not found: ${p}`);
  }
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function writeOutput(data: unknown): void {
  mkdirSync(stageDir, { recursive: true });
  const out = outputPath();
  // Back up existing output before overwriting (preserves history on re-runs)
  if (existsSync(out)) {
    let n = 1;
    while (existsSync(resolve(stageDir, `output-${n}.json`))) n++;
    const backup = resolve(stageDir, `output-${n}.json`);
    writeFileSync(backup, readFileSync(out));
    console.log(`  backed up previous output → ${backup}`);
  }
  writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`  output → ${out}`);
}

function writeNextInput(nextStage: string, data: unknown): void {
  const dir = resolve(RUN_DIR, nextStage);
  mkdirSync(dir, { recursive: true });
  writeFileSync(nextInputPath(nextStage), JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Agent routing
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateConfig(["parallelApiKey"]);

  console.log(`[${AGENT_ID}] starting → ${stageDir}`);
  const start = performance.now();

  switch (AGENT_ID) {
    // ── Researcher ────────────────────────────────────────────────────────
    case "researcher": {
      const items = await researchNews();
      writeOutput(items);
      writeNextInput("edit", items);
      console.log(`  collected ${items.length} items`);
      break;
    }

    // ── Editor ────────────────────────────────────────────────────────────
    case "editor": {
      const items = readInput<NewsItem[]>();
      const decision = await editDigest(items);
      writeOutput(decision);
      writeNextInput("write", decision.stories);
      console.log(`  selected ${decision.stories.length} stories from ${items.length} items`);
      break;
    }

    // ── X Writer ──────────────────────────────────────────────────────────
    case "x-writer": {
      const stories = readInput<CuratedStory[]>();

      let content: DigestContent | undefined;
      let qaResult: QaResult | undefined;
      const MAX_REVISIONS = 2;

      for (let attempt = 0; attempt <= MAX_REVISIONS; attempt++) {
        const revisionFeedback =
          content && qaResult?.revision_notes
            ? { draft: content, notes: qaResult.revision_notes }
            : undefined;
        content = await writeDigest(stories, { revisionFeedback });
        qaResult = await reviewDigest(content, stories);
        if (!qaResult.needs_revision || attempt === MAX_REVISIONS) break;
        console.log(`  [x-writer] revision ${attempt + 1} needed: ${qaResult.revision_notes}`);
      }

      writeOutput(content!);
      writeNextInput("visuals", content!);
      console.log(`  generated ${content!.x_thread.segments.length} segments`);
      break;
    }

    // ── Visuals Scout ─────────────────────────────────────────────────────
    case "visuals-scout": {
      const content = readInput<DigestContent>();
      const mediaDir = resolve(stageDir, "media");
      mkdirSync(mediaDir, { recursive: true });
      const enriched = await resolveVisuals(content, mediaDir);
      writeOutput(enriched);

      // publisher needs enriched content
      writeNextInput("publish", enriched);

      const mediaCount = enriched.x_thread.segments.filter((s) => s.media).length;
      console.log(`  resolved media for ${mediaCount} segments`);
      break;
    }

    // ── Publisher ─────────────────────────────────────────────────────────
    case "publisher": {
      const content = readInput<DigestContent>();
      const date = new Date().toISOString().slice(0, 10);

      const mediaMap = await uploadAllMedia(content.x_thread.segments);
      if (mediaMap.size > 0) {
        console.log(`  uploaded ${mediaMap.size} media file(s)`);
      }

      const segments = content.x_thread.segments.map((s) => ({
        text: s.text,
        media_id: mediaMap.get(s.position),
      }));

      const result = await createDraft(
        segments,
        "next-free-slot",
        `Daily AI News — ${date}`,
      );

      writeOutput({ typefully: result, published_at: new Date().toISOString() });

      if (result.status === "failed") {
        console.error(`  Typefully error: ${result.error}`);
        process.exit(1);
      } else {
        console.log(`  draft: ${result.private_url ?? result.draft_id}`);
        if (result.scheduled_at) console.log(`  scheduled: ${result.scheduled_at}`);
      }

      // Update ledger
      const decision = readStageOutput<EditorialDecision>("edit");
      updateLedger(decision.stories);
      break;
    }

    default:
      console.error(`Unknown agent ID: "${AGENT_ID}"`);
      console.error(`Valid agents: researcher, editor, x-writer, visuals-scout, publisher`);
      process.exit(1);
  }

  const elapsed = Math.round(performance.now() - start);
  console.log(`[${AGENT_ID}] done in ${(elapsed / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
// Ledger update
// ---------------------------------------------------------------------------

function updateLedger(stories: CuratedStory[]): void {
  const ledger = loadLedger();
  const now = new Date().toISOString();

  for (const story of stories) {
    const key = normalizeUrl(story.url);
    if (!ledger[key]) {
      ledger[key] = {
        url: story.url,
        first_seen: now,
        last_seen: now,
        score: undefined,
        num_comments: undefined,
        source: story.source,
        surface_ids: ["digest"],
      };
    } else {
      ledger[key].last_seen = now;
      if (!ledger[key].surface_ids.includes("digest")) {
        ledger[key].surface_ids.push("digest");
      }
    }
  }

  saveLedger(ledger);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(
    `[${AGENT_ID}] fatal:`,
    err instanceof Error ? err.message : String(err),
  );
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
