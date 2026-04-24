import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runPipeline, resumePipeline, type PipelineOpts, type StageName } from "./pipeline.js";
import { validateConfig } from "./config.js";
import { runAnalyst } from "./agents/analyst.js";
import { buildAndWriteManifest } from "./manifest.js";

/* ------------------------------------------------------------------ */
/*  CLI arg parsing                                                    */
/* ------------------------------------------------------------------ */

interface CliOpts {
  mode: "pipeline" | "resume" | "analyst" | "build-manifest";
  // Pipeline opts
  surfaces?: string[];
  type?: "permanent" | "rotating";
  maxTier?: 1 | 2 | 3;
  through?: StageName;
  topN: number;
  channel?: string;
  maxConcurrent: number;
  packetId?: string;
  publisher: boolean;
  // Resume
  resumeRunId?: string;
  // Analyst
  scoringWindow: "7d" | "14d" | "30d" | "90d";
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const opts: CliOpts = {
    mode: "pipeline",
    topN: 0,
    maxConcurrent: 3,
    publisher: false,
    scoringWindow: "7d",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      // Surface selection
      case "--surface":
        opts.surfaces = (opts.surfaces ?? []).concat(args[++i]);
        break;
      case "--type":
        opts.type = args[++i] as "permanent" | "rotating";
        break;
      case "--max-tier":
        opts.maxTier = Number(args[++i]) as 1 | 2 | 3;
        break;

      // Pipeline control
      case "--through":
        opts.through = args[++i] as StageName;
        break;
      case "--publisher":
        opts.publisher = true;
        break;
      case "--top-n":
        opts.topN = Number(args[++i]);
        break;
      case "--channel":
        opts.channel = args[++i];
        break;
      case "--packet":
        opts.packetId = args[++i];
        break;
      case "--concurrency":
        opts.maxConcurrent = Number(args[++i]);
        break;

      // Resume
      case "--resume": {
        opts.mode = "resume";
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          opts.resumeRunId = args[++i];
        }
        break;
      }

      // Standalone commands
      case "--analyst-only":
        opts.mode = "analyst";
        break;
      case "--build-manifest":
        opts.mode = "build-manifest";
        break;
      case "--scoring-window":
        opts.scoringWindow = args[++i] as "7d" | "14d" | "30d" | "90d";
        break;
    }
  }

  return opts;
}

/* ------------------------------------------------------------------ */
/*  Standalone commands (not part of the pipeline)                     */
/* ------------------------------------------------------------------ */

async function runAnalystOnly(scoringWindow: string): Promise<void> {
  const scorecardsPath = resolve(import.meta.dirname, "../data/scorecard.json");
  const runId = new Date().toISOString().slice(0, 10);
  console.log(`Running analyst-only on ${scorecardsPath}`);

  console.log("\n--- Running analyst (Layer 6) ---");
  const analystOutDir = resolve(import.meta.dirname, "../data");
  const analystOutPath = resolve(analystOutDir, "analyst-output.json");
  const analystOutput = await runAnalyst(scorecardsPath, analystOutPath, runId);

  if (analystOutput) {
    if (analystOutput.strategy_notes.length > 0) {
      console.log(`\nStrategy notes:`);
      for (const note of analystOutput.strategy_notes) console.log(`  - ${note}`);
    }
    if (analystOutput.registry_updates.length > 0) {
      console.log(`\nRegistry updates:`);
      for (const u of analystOutput.registry_updates) console.log(`  ${u.action.toUpperCase()} ${u.surface_id}: ${u.reason}`);
    }
    if (analystOutput.packet_heuristic_updates.length > 0) {
      console.log(`\nPacket heuristic updates:`);
      for (const h of analystOutput.packet_heuristic_updates) console.log(`  ${h.adjustment} ${h.format}/${h.channel}: ${h.reason}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Analyst complete -> ${analystOutPath}`);
  console.log("=".repeat(70));
}

function runBuildManifest(): void {
  const runsDir = resolve(import.meta.dirname, "../data/runs");
  const entries = readdirSync(runsDir).sort().reverse();

  // Find latest run with a packet dir containing creator-output.json
  let runDir: string | null = null;
  for (const entry of entries) {
    const entryDir = resolve(runsDir, entry);
    try {
      const subs = readdirSync(entryDir).filter((s: string) => s.startsWith("packet-"));
      for (const sub of subs) {
        try {
          readFileSync(resolve(entryDir, sub, "creator-output.json"));
          runDir = entryDir;
          break;
        } catch { continue; }
      }
      if (runDir) break;
      // Also check root-level creator-output.json (legacy)
      try {
        readFileSync(resolve(entryDir, "creator-output.json"));
        runDir = entryDir;
        break;
      } catch { continue; }
    } catch { continue; }
  }

  if (!runDir) throw new Error("No previous run with creator-output.json found");

  console.log(`Building manifest from ${runDir}`);

  // Check for packet subdirs first
  const packetDirs = readdirSync(runDir).filter((s: string) => s.startsWith("packet-")).sort();
  const strategistPath = resolve(runDir, "strategist-output.json");

  if (packetDirs.length > 0) {
    for (const sub of packetDirs) {
      const packetDir = resolve(runDir, sub);
      const creatorPath = resolve(packetDir, "creator-output.json");
      try { readFileSync(creatorPath); } catch { continue; }

      const manifestOutPath = resolve(packetDir, "manifest.json");
      const tryRead = (p: string) => { try { readFileSync(p); return p; } catch { return null; } };
      const entries = buildAndWriteManifest(
        strategistPath, creatorPath, manifestOutPath,
        tryRead(resolve(packetDir, "derivatives-output.json")),
        tryRead(resolve(packetDir, "publisher-output.json")),
        tryRead(resolve(packetDir, "syndication-publisher-output.json")),
        tryRead(resolve(packetDir, "syndication-output.json")),
      );
      console.log(`\n${sub} manifest entries:`);
      for (const e of entries) console.log(`  ${e.asset_id}: ${e.channel} / ${e.asset_type}`);
    }
  } else {
    // Legacy: root-level outputs
    const creatorPath = resolve(runDir, "creator-output.json");
    const manifestOutPath = resolve(runDir, "manifest.json");
    const tryRead = (p: string) => { try { readFileSync(p); return p; } catch { return null; } };
    const entries = buildAndWriteManifest(
      strategistPath, creatorPath, manifestOutPath,
      tryRead(resolve(runDir, "derivatives-output.json")),
      tryRead(resolve(runDir, "publisher-output.json")),
      tryRead(resolve(runDir, "syndication-publisher-output.json")),
      tryRead(resolve(runDir, "syndication-output.json")),
    );
    console.log(`\nManifest entries:`);
    for (const e of entries) console.log(`  ${e.asset_id}: ${e.channel} / ${e.asset_type}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("Manifest complete");
  console.log("=".repeat(70));
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs();

  // Fail fast if required env vars are missing
  validateConfig(["parallelApiKey", "ghostUrl", "ghostAdminKey"]);

  switch (opts.mode) {
    case "analyst":
      await runAnalystOnly(opts.scoringWindow);
      return;

    case "build-manifest":
      runBuildManifest();
      return;

    case "resume":
      await resumePipeline(opts.resumeRunId);
      return;

    case "pipeline": {
      // Determine the --through stage
      let through: StageName | undefined = opts.through;
      if (!through && opts.publisher) through = "publisher";

      // Default: run through creator (not publisher) unless explicitly requested
      if (!through) through = "creator";

      const pipelineOpts: PipelineOpts = {
        ids: opts.surfaces,
        type: opts.type,
        maxTier: opts.maxTier,
        through,
        topN: opts.topN,
        channel: opts.channel,
        maxConcurrent: opts.maxConcurrent,
        packetId: opts.packetId,
      };

      await runPipeline(pipelineOpts);
      return;
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
