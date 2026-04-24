import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import "dotenv/config";

/**
 * Nightly orchestrator: runs all syncs in sequence then generates the scorecard.
 *
 * sync-articles → sync-otterly → sync-gsc → update-llms → scorer
 *
 * Usage: npx tsx src/sync/run-nightly.ts [--otterly-prompts-csv <path>] [--otterly-citations-csv <path>]
 */
async function main() {
  const args = process.argv.slice(2);
  let otterlyPromptsCsv: string | undefined;
  let otterlyCitationsCsv: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--otterly-prompts-csv") otterlyPromptsCsv = args[++i];
    if (args[i] === "--otterly-citations-csv") otterlyCitationsCsv = args[++i];
  }

  const today = new Date().toISOString().slice(0, 10);
  const logsDir = resolve(import.meta.dirname, "../../data/logs");
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  const logPath = resolve(logsDir, `nightly-${today}.log`);
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    appendFileSync(logPath, line + "\n");
  };

  const projectRoot = resolve(import.meta.dirname, "../..");

  const run = (label: string, cmd: string) => {
    log(`Starting: ${label}`);
    try {
      const output = execSync(cmd, {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 300_000, // 5 min per step
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      });
      log(`Completed: ${label}`);
      if (output.trim()) {
        for (const line of output.trim().split("\n")) {
          appendFileSync(logPath, `  ${line}\n`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`FAILED: ${label} — ${msg}`);
    }
  };

  log("=== Nightly sync started ===");

  // 1. Sync articles from manifests
  run("sync-articles", "npx tsx src/sync/sync-articles.ts");

  // 2. Sync Otterly (if CSV paths provided)
  if (otterlyPromptsCsv || otterlyCitationsCsv) {
    const otterlyArgs: string[] = [];
    if (otterlyPromptsCsv) otterlyArgs.push("--prompts-csv", otterlyPromptsCsv);
    if (otterlyCitationsCsv) otterlyArgs.push("--citations-csv", otterlyCitationsCsv);
    run("sync-otterly", `npx tsx src/sync/sync-otterly.ts ${otterlyArgs.join(" ")}`);
  } else {
    log("Skipping sync-otterly (no CSV paths provided)");
  }

  // 3. Sync GSC
  run("sync-gsc", "npx tsx src/sync/sync-gsc.ts");

  // 4. Update llms.txt
  run("update-llms", "npx tsx src/scripts/update-llms.ts");

  // 5. Generate scorecard
  run("scorecard", "npx tsx src/agents/scorer.ts");

  // 6. Drain syndication queue (up to 2 posts/day)
  run("drain-syndication", "npx tsx src/scripts/drain-syndication-queue.ts");

  log("=== Nightly sync complete ===");
  console.log(`Log → ${logPath}`);
}

main().catch((err) => {
  console.error("[nightly] Fatal:", err);
  process.exit(1);
});
