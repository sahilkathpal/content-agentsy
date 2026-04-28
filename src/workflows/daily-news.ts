import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { researchNews } from "../agents/news-researcher.js";
import { editDigest } from "../agents/news-editor.js";
import { writeDigest, generateCompanion } from "../agents/news-writer.js";
import { resolveVisuals } from "../agents/visuals-scout.js";
import { reviewDigest } from "../agents/news-qa.js";
import { createDraft, uploadAllMedia } from "../tools/typefully.js";
import { normalizeUrl, loadLedger, saveLedger } from "../ledger.js";
import {
  withTiming,
  type CuratedStory,
  type EditorialDecision,
  type DigestContent,
  type NewsItem,
} from "../models/digest.js";

const RUNS_DIR = resolve(import.meta.dirname, "../../data/runs");

// ---------------------------------------------------------------------------
// Stage checkpointing
// ---------------------------------------------------------------------------

type StageName = "research" | "edit" | "write" | "visuals" | "publish";
type StageStatus = "pending" | "done" | "failed";
type DigestState = Record<StageName, StageStatus>;

const STAGES: StageName[] = ["research", "edit", "write", "visuals", "publish"];

function freshState(): DigestState {
  return { research: "pending", edit: "pending", write: "pending", visuals: "pending", publish: "pending" };
}

function loadState(runDir: string): DigestState {
  const p = resolve(runDir, "digest-state.json");
  if (!existsSync(p)) return freshState();
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return freshState(); }
}

function saveState(runDir: string, state: DigestState): void {
  writeFileSync(resolve(runDir, "digest-state.json"), JSON.stringify(state, null, 2));
}

function markStage(runDir: string, state: DigestState, stage: StageName, status: StageStatus): void {
  state[stage] = status;
  saveState(runDir, state);
}

function firstIncompleteStage(state: DigestState): StageName | null {
  for (const stage of STAGES) {
    if (state[stage] !== "done") return stage;
  }
  return null;
}

export interface DailyNewsOpts {
  publish: boolean;
  skipVisuals?: boolean;
  resume?: string; // date or run-id to resume
}

/**
 * Run the daily coding agents news workflow:
 * Research → Edit → Write → Visuals + Companion (parallel) → Publish
 *
 * Supports --resume to pick up from the last failed/incomplete stage.
 */
export async function runDailyNews(opts: DailyNewsOpts): Promise<void> {
  const date = opts.resume ?? new Date().toISOString().slice(0, 10);
  const runDir = resolve(RUNS_DIR, `digest-${date}`);
  mkdirSync(runDir, { recursive: true });

  const state = loadState(runDir);
  const resumeFrom = firstIncompleteStage(state);

  console.log("=".repeat(70));
  console.log(`Daily Coding Agents News — ${date}`);
  if (opts.resume) console.log(`Resuming from: ${resumeFrom ?? "complete"}`);
  console.log("=".repeat(70));

  const timings: Record<string, number> = {};

  // -- 1. Research --
  let items: NewsItem[];
  if (state.research === "done") {
    items = readJSON<NewsItem[]>(runDir, "raw-items.json");
    console.log(`\n--- Researcher (cached: ${items.length} items) ---`);
  } else {
    console.log("\n--- Researcher ---");
    const r = await withTiming("research", () => researchNews());
    items = r.data;
    timings.research = r.duration_ms;
    writeJSON(runDir, "raw-items.json", items);
    markStage(runDir, state, "research", "done");
  }

  if (items.length === 0) {
    console.log("\nNo items found from any source. Skipping.");
    return;
  }

  // -- 2. Edit --
  let decision: EditorialDecision;
  if (state.edit === "done") {
    decision = readJSON<EditorialDecision>(runDir, "editorial-decision.json");
    console.log(`\n--- Editor (cached: ${decision.stories.length} stories) ---`);
  } else {
    console.log("\n--- Editor ---");
    const r = await withTiming("edit", () => editDigest(items));
    decision = r.data;
    timings.edit = r.duration_ms;
    writeJSON(runDir, "editorial-decision.json", decision);
    markStage(runDir, state, "edit", "done");
  }

  if (decision.stories.length === 0) {
    console.log("\nEditor found no stories worth covering. Skipping.");
    return;
  }

  // -- 3. Write (thread only) --
  let threadContent: DigestContent;
  if (state.write === "done") {
    threadContent = readJSON<DigestContent>(runDir, "digest-content.json");
    console.log(`\n--- Writer (cached: ${threadContent.x_thread.segments.length} segments) ---`);
  } else {
    console.log("\n--- Writer (thread) ---");
    const r = await withTiming("write", () => writeDigest(decision.stories, { threadOnly: true }));
    threadContent = r.data;
    timings.write = r.duration_ms;
    writeJSON(runDir, "digest-content.json", threadContent);
    markStage(runDir, state, "write", "done");
  }

  // -- 3.5 Visuals + Companion in parallel --
  let enrichedContent: DigestContent;
  if (state.visuals === "done") {
    enrichedContent = readJSON<DigestContent>(runDir, "digest-content-with-media.json");
    console.log(`\n--- Visuals + Companion (cached) ---`);
  } else {
    const mediaDir = resolve(runDir, "media");
    mkdirSync(mediaDir, { recursive: true });

    console.log("\n--- Visuals Scout + Companion Post (parallel) ---");
    const r = await withTiming("visuals+companion", async () => {
      const visualsPromise = opts.skipVisuals
        ? Promise.resolve(threadContent)
        : resolveVisuals(threadContent, mediaDir);

      const companionPromise = generateCompanion(
        decision.stories,
        threadContent.x_thread,
        { date, model: "claude-sonnet-4-6" },
      );

      const [visualResult, companion] = await Promise.all([visualsPromise, companionPromise]);
      return { ...visualResult, companion_post: companion } as DigestContent;
    });

    enrichedContent = r.data;
    timings["visuals+companion"] = r.duration_ms;
    writeJSON(runDir, "digest-content-with-media.json", enrichedContent);

    const companionPath = resolve(runDir, "companion-post.md");
    writeFileSync(companionPath, `# ${enrichedContent.companion_post.title}\n\n${enrichedContent.companion_post.body}`);
    console.log(`  Companion post → ${companionPath}`);

    markStage(runDir, state, "visuals", "done");
  }

  // -- 3.75 QA Review (soft gate) --
  console.log("\n--- QA Review ---");
  const qaR = await withTiming("qa", () => reviewDigest(enrichedContent, decision.stories));
  timings.qa = qaR.duration_ms;
  writeJSON(runDir, "qa-result.json", qaR.data);

  // -- 4. Publish --
  if (opts.publish) {
    if (state.publish === "done") {
      console.log("\n--- Publisher (already published) ---");
    } else {
      console.log("\n--- Publisher ---");
      const pubR = await withTiming("publish", async () => {
        const mediaMap = await uploadAllMedia(enrichedContent.x_thread.segments);
        if (mediaMap.size > 0) {
          console.log(`  Uploaded ${mediaMap.size} media file(s)`);
        }

        const segments = enrichedContent.x_thread.segments.map((s) => ({
          text: s.text,
          media_id: mediaMap.get(s.position),
        }));

        return createDraft(
          segments,
          enrichedContent.companion_post,
          "next-free-slot",
          `Daily AI News — ${date}`,
        );
      });

      timings.publish = pubR.duration_ms;

      writeJSON(runDir, "publish-result.json", {
        typefully: pubR.data,
        published_at: new Date().toISOString(),
      });

      if (pubR.data.status === "failed") {
        console.error(`\nTypefully publishing failed: ${pubR.data.error}`);
      } else {
        console.log(`\nTypefully draft created: ${pubR.data.private_url ?? pubR.data.draft_id}`);
        if (pubR.data.scheduled_at) console.log(`Scheduled for: ${pubR.data.scheduled_at}`);
        markStage(runDir, state, "publish", "done");
      }
    }
  } else {
    console.log("\n(Skipping publish — run with --publisher to post to Typefully)");
  }

  // Update ledger with all story URLs
  updateLedgerWithStories(decision.stories);

  // Timing summary
  const timingSummary = Object.entries(timings)
    .map(([stage, ms]) => `${stage}: ${(ms / 1000).toFixed(1)}s`)
    .join(" | ");
  if (timingSummary) console.log(`\nTiming: ${timingSummary}`);

  console.log("\n" + "=".repeat(70));
  console.log(`Digest complete → ${runDir}`);
  console.log("=".repeat(70));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeJSON(dir: string, filename: string, data: unknown): void {
  const path = resolve(dir, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function readJSON<T>(dir: string, filename: string): T {
  const path = resolve(dir, filename);
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function updateLedgerWithStories(stories: CuratedStory[]): void {
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


