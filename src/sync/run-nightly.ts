import { mkdirSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import "dotenv/config";

/**
 * Nightly orchestrator: runs all syncs in sequence then generates the scorecard.
 *
 * sync-articles → sync-otterly → sync-gsc → update-llms → scorer
 *
 * Otterly CSVs are auto-discovered from OTTERLY_EXPORTS_DIR (default: otterly-exports/)
 * by picking the latest prompts-*.csv and citations-*.csv by filename.
 */

function findLatestCsv(dir: string, prefix: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const matches = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".csv"))
    .sort();
  if (matches.length === 0) return undefined;
  return resolve(dir, matches[matches.length - 1]);
}

async function main() {

  const projectRoot = resolve(import.meta.dirname, "../..");
  const otterlyExportsDir = process.env.OTTERLY_EXPORTS_DIR
    ? resolve(process.env.OTTERLY_EXPORTS_DIR)
    : resolve(projectRoot, "otterly-exports");

  const otterlyPromptsCsv = findLatestCsv(otterlyExportsDir, "prompts-");
  const otterlyCitationsCsv = findLatestCsv(otterlyExportsDir, "citations-");

  const today = new Date().toISOString().slice(0, 10);
  const logsDir = resolve(import.meta.dirname, "../../data/logs");
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  const logPath = resolve(logsDir, `nightly-${today}.log`);
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    appendFileSync(logPath, line + "\n");
  };

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

  // 2. Sync Otterly (auto-discover latest CSVs from otterly-exports dir)
  if (otterlyPromptsCsv || otterlyCitationsCsv) {
    const otterlyArgs: string[] = [];
    if (otterlyPromptsCsv) otterlyArgs.push("--prompts-csv", otterlyPromptsCsv);
    if (otterlyCitationsCsv) otterlyArgs.push("--citations-csv", otterlyCitationsCsv);
    run("sync-otterly", `npx tsx src/sync/sync-otterly.ts ${otterlyArgs.join(" ")}`);
  } else {
    log(`Skipping sync-otterly (no CSVs found in ${otterlyExportsDir})`);
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
