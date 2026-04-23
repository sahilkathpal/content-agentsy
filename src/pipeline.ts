import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runScout } from "./stages/scout.js";
import { runStrategistStage } from "./stages/strategist.js";
import { runCreatorStage } from "./stages/creator.js";
import { runPublisherStage } from "./stages/publisher.js";
import { fetchBlogIndex } from "./sources/blog-index.js";
import { loadRegistry, selectSurfaces, type SelectOptions } from "./registry/registry.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type StageName = "scout" | "strategist" | "creator" | "publisher";

export type StageStatus = "pending" | "running" | "done" | "failed";

export interface StageState {
  status: StageStatus;
  started_at?: string;
  finished_at?: string;
  error?: string;
}

export interface RunState {
  run_id: string;
  run_dir: string;
  stages: Record<StageName, StageState>;
  config: {
    surfaces?: string[];
    type?: string;
    maxTier?: number;
    top_n: number;
    channel?: string;
    concurrency: number;
  };
}

export interface PipelineOpts extends SelectOptions {
  through?: StageName;
  topN: number;
  channel?: string;
  maxConcurrent: number;
  packetId?: string;
}

const STAGE_ORDER: StageName[] = ["scout", "strategist", "creator", "publisher"];

/* ------------------------------------------------------------------ */
/*  State persistence                                                  */
/* ------------------------------------------------------------------ */

function stateFilePath(runDir: string): string {
  return resolve(runDir, "run-state.json");
}

function readState(runDir: string): RunState {
  return JSON.parse(readFileSync(stateFilePath(runDir), "utf-8"));
}

function writeState(state: RunState): void {
  writeFileSync(stateFilePath(state.run_dir), JSON.stringify(state, null, 2));
}

function freshState(runId: string, runDir: string, opts: PipelineOpts): RunState {
  return {
    run_id: runId,
    run_dir: runDir,
    stages: {
      scout:      { status: "pending" },
      strategist: { status: "pending" },
      creator:    { status: "pending" },
      publisher:  { status: "pending" },
    },
    config: {
      surfaces: opts.ids,
      type: opts.type,
      maxTier: opts.maxTier,
      top_n: opts.topN,
      channel: opts.channel,
      concurrency: opts.maxConcurrent,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Shared context built up across stages                              */
/* ------------------------------------------------------------------ */

export interface PipelineContext {
  runDir: string;
  runId: string;
  blogIndex?: string;
  opts: PipelineOpts;
}

/* ------------------------------------------------------------------ */
/*  Stage runner                                                       */
/* ------------------------------------------------------------------ */

async function executeStage(
  stage: StageName,
  state: RunState,
  ctx: PipelineContext,
): Promise<void> {
  state.stages[stage] = { status: "running", started_at: new Date().toISOString() };
  writeState(state);

  try {
    switch (stage) {
      case "scout":
        await runScout(ctx);
        break;
      case "strategist":
        await runStrategistStage(ctx);
        break;
      case "creator":
        await runCreatorStage(ctx);
        break;
      case "publisher":
        await runPublisherStage(ctx);
        break;
    }
    state.stages[stage].status = "done";
    state.stages[stage].finished_at = new Date().toISOString();
    writeState(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.stages[stage].status = "failed";
    state.stages[stage].error = msg;
    state.stages[stage].finished_at = new Date().toISOString();
    writeState(state);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run the full pipeline (or up to --through stage) from scratch.
 */
export async function runPipeline(opts: PipelineOpts): Promise<void> {
  const registry = loadRegistry();
  console.log(`Registry: ${registry.surfaces.length} surfaces, ${registry.subreddits.length} subreddits, ${registry.competitors.length} competitors`);

  const surfaces = selectSurfaces(registry, opts);
  console.log(`Selected ${surfaces.length} surfaces:\n${surfaces.map((s) => `  [tier ${s.tier}] ${s.id}`).join("\n")}\n`);

  if (surfaces.length === 0) {
    console.log("No surfaces selected. Use --surface <id>, --type <permanent|rotating>, or --max-tier <1|2|3>.");
    process.exit(0);
  }

  // Ensure surface IDs are stored for resume
  opts.ids = surfaces.map((s) => s.id);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = resolve(import.meta.dirname, "../data/runs", timestamp);
  mkdirSync(runDir, { recursive: true });

  const state = freshState(timestamp, runDir, opts);
  writeState(state);

  // Fetch blog index once (used by strategist + creator)
  console.log("Fetching blog index...");
  const blogIndex = await fetchBlogIndex();
  if (blogIndex) console.log(`  ${blogIndex.split("\n").length} existing posts loaded`);

  const ctx: PipelineContext = { runDir, runId: timestamp, blogIndex: blogIndex ?? undefined, opts };

  const lastStage = opts.through ?? "publisher";
  const lastIdx = STAGE_ORDER.indexOf(lastStage);

  for (let i = 0; i <= lastIdx; i++) {
    const stage = STAGE_ORDER[i];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Stage: ${stage}`);
    console.log("=".repeat(60));
    await executeStage(stage, state, ctx);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Run complete -> ${runDir}`);
  console.log("=".repeat(70));
}

/**
 * Resume a failed or partial run from the next incomplete stage.
 * If no runId given, picks the latest run directory.
 */
export async function resumePipeline(runId?: string): Promise<void> {
  const runsDir = resolve(import.meta.dirname, "../data/runs");
  let runDir: string;

  if (runId) {
    runDir = resolve(runsDir, runId);
  } else {
    // Find latest run with a run-state.json
    const entries = readdirSync(runsDir).sort().reverse();
    const found = entries.find((e) => {
      try { readFileSync(resolve(runsDir, e, "run-state.json")); return true; } catch { return false; }
    });
    if (!found) throw new Error("No previous run with run-state.json found in data/runs/");
    runDir = resolve(runsDir, found);
  }

  const state = readState(runDir);
  console.log(`Resuming run ${state.run_id} from ${runDir}`);

  // Show current state
  for (const [stage, info] of Object.entries(state.stages)) {
    console.log(`  ${stage}: ${info.status}${info.error ? ` (${info.error.slice(0, 80)})` : ""}`);
  }

  // Find first non-done stage
  const startIdx = STAGE_ORDER.findIndex((s) => state.stages[s].status !== "done");
  if (startIdx === -1) {
    console.log("\nAll stages already complete. Nothing to resume.");
    return;
  }

  // Rebuild opts from state config
  const opts: PipelineOpts = {
    ids: state.config.surfaces,
    type: state.config.type as PipelineOpts["type"],
    maxTier: state.config.maxTier as PipelineOpts["maxTier"],
    topN: state.config.top_n,
    channel: state.config.channel,
    maxConcurrent: state.config.concurrency,
  };

  // Fetch blog index
  console.log("\nFetching blog index...");
  const blogIndex = await fetchBlogIndex();
  if (blogIndex) console.log(`  ${blogIndex.split("\n").length} existing posts loaded`);

  const ctx: PipelineContext = { runDir, runId: state.run_id, blogIndex: blogIndex ?? undefined, opts };

  for (let i = startIdx; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Stage: ${stage} (resumed)`);
    console.log("=".repeat(60));
    await executeStage(stage, state, ctx);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Resume complete -> ${runDir}`);
  console.log("=".repeat(70));
}
