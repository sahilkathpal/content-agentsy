import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { researchNews } from "../agents/news-researcher.js";
import { editDigest } from "../agents/news-editor.js";
import { writeDigest } from "../agents/news-writer.js";
import { resolveVisuals } from "../agents/visuals-scout.js";
import { reviewDigest } from "../agents/news-qa.js";
import { createDraft, uploadAllMedia } from "../tools/typefully.js";
import { normalizeUrl, loadLedger, saveLedger } from "../ledger.js";
import type { NewsItem, CuratedStory, EditorialDecision, DigestContent } from "../models/digest.js";
import type { QaResult } from "../agents/news-qa.js";

export interface DailyNewsOpts {
  publish: boolean;
  skipVisuals?: boolean;
  resume?: string; // path to run dir to resume from
}

const ROOT = resolve(import.meta.dirname, "../..");

function runDir(): string {
  const date = new Date().toISOString().slice(0, 10);
  return resolve(ROOT, "data/runs", `twitter-news-thread-${date}`);
}

function writeStageOutput(dir: string, stage: string, data: unknown): void {
  const stageDir = resolve(dir, stage);
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(resolve(stageDir, "output.json"), JSON.stringify(data, null, 2));
}

function readStageOutput<T>(dir: string, stage: string): T | null {
  const p = resolve(dir, stage, "output.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

export async function runDailyNews(opts: DailyNewsOpts): Promise<void> {
  const dir = opts.resume ? resolve(ROOT, opts.resume) : runDir();
  mkdirSync(dir, { recursive: true });

  // ── Research ──────────────────────────────────────────────────────────────
  let items: NewsItem[];
  const cachedResearch = readStageOutput<NewsItem[]>(dir, "research");
  if (cachedResearch) {
    items = cachedResearch;
    console.log(`\n[researcher] loaded ${items.length} items from cache`);
  } else {
    console.log("\n[researcher] starting…");
    const t0 = performance.now();
    items = await researchNews();
    writeStageOutput(dir, "research", items);
    console.log(`[researcher] collected ${items.length} items in ${elapsed(t0)}s`);
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  let decision: EditorialDecision;
  const cachedEdit = readStageOutput<EditorialDecision>(dir, "edit");
  if (cachedEdit) {
    decision = cachedEdit;
    console.log(`\n[editor] loaded decision from cache (${decision.stories.length} stories)`);
  } else {
    console.log("\n[editor] starting…");
    const t1 = performance.now();
    decision = await editDigest(items);
    writeStageOutput(dir, "edit", decision);
    console.log(
      `[editor] selected ${decision.stories.length} stories from ${items.length} items in ${elapsed(t1)}s`,
    );
  }

  if (!decision.publishable) {
    console.log(`\n[orchestrator] not publishable: ${decision.skip_reason ?? "unknown reason"}`);
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  let content: DigestContent;
  const cachedWrite = readStageOutput<DigestContent>(dir, "write");
  if (cachedWrite) {
    content = cachedWrite;
    console.log(`\n[x-writer] loaded thread from cache (${content.x_thread.segments.length} segments)`);
  } else {
    console.log("\n[x-writer] starting…");
    const t2 = performance.now();
    content = await writeDigest(decision.stories);
    writeStageOutput(dir, "write", content);
    console.log(
      `[x-writer] generated ${content.x_thread.segments.length} segments in ${elapsed(t2)}s`,
    );
  }

  // ── Visuals ───────────────────────────────────────────────────────────────
  let enriched = content;
  if (!opts.skipVisuals) {
    const cachedVisuals = readStageOutput<DigestContent>(dir, "visuals");
    if (cachedVisuals) {
      enriched = cachedVisuals;
      const mediaCount = enriched.x_thread.segments.filter((s) => s.media).length;
      console.log(`\n[visuals-scout] loaded visuals from cache (${mediaCount} segments with media)`);
    } else {
      console.log("\n[visuals-scout] starting…");
      const t3 = performance.now();
      const mediaDir = resolve(dir, "visuals", "media");
      mkdirSync(mediaDir, { recursive: true });
      enriched = await resolveVisuals(content, mediaDir);
      writeStageOutput(dir, "visuals", enriched);
      const mediaCount = enriched.x_thread.segments.filter((s) => s.media).length;
      console.log(`[visuals-scout] resolved media for ${mediaCount} segments in ${elapsed(t3)}s`);
    }
  }

  // ── QA ────────────────────────────────────────────────────────────────────
  const cachedQa = readStageOutput<QaResult>(dir, "qa");
  if (cachedQa) {
    console.log(`\n[qa] loaded QA from cache (score: ${cachedQa.llm_review?.score ?? "n/a"})`);
  } else {
    console.log("\n[qa] starting…");
    const t4 = performance.now();
    const qa = await reviewDigest(enriched, decision.stories);
    writeStageOutput(dir, "qa", qa);
    console.log(`[qa] score: ${qa.llm_review?.score ?? "n/a"} in ${elapsed(t4)}s`);
  }

  // ── Publish ───────────────────────────────────────────────────────────────
  if (!opts.publish) {
    console.log("\n[orchestrator] dry run — skipping publish. Pass --publisher to publish.");
    return;
  }

  console.log("\n[publisher] uploading media…");
  const t5 = performance.now();
  const mediaMap = await uploadAllMedia(enriched.x_thread.segments);
  if (mediaMap.size > 0) {
    console.log(`  uploaded ${mediaMap.size} media file(s)`);
  }

  const segments = enriched.x_thread.segments.map((s) => ({
    text: s.text,
    media_id: mediaMap.get(s.position),
  }));

  const date = new Date().toISOString().slice(0, 10);
  const result = await createDraft(segments, "next-free-slot", `Daily AI News — ${date}`);

  const publishResult = { typefully: result, published_at: new Date().toISOString() };
  writeStageOutput(dir, "publish", publishResult);

  if (result.status === "failed") {
    throw new Error(`Typefully error: ${result.error}`);
  }

  console.log(`[publisher] draft: ${result.private_url ?? result.draft_id} in ${elapsed(t5)}s`);
  if (result.scheduled_at) console.log(`  scheduled: ${result.scheduled_at}`);

  updateLedger(decision.stories);
  console.log(`\n[orchestrator] done. Run artifacts: ${dir}`);
}

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

function elapsed(since: number): string {
  return ((performance.now() - since) / 1000).toFixed(1);
}
