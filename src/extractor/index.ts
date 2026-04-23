import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { collectSourceFiles, runFullExtraction, runIncrementalExtraction } from "./extract.js";

// ── Repo config ──────────────────────────────────────────────────────────────

const REPOS = [
  {
    name: "grass-ide",
    path: "/Users/sahilkathpal/code/grass-ide",
    outputFile: "_extracted-ide.md",
    topic: "ide-technical",
    description: "Grass CLI + server technical context extracted from grass-ide codebase",
    consumers: ["strategist", "creator-evaluate", "creator-integrate", "creator-execute"],
    priority: 3,
  },
  {
    name: "grass-expo",
    path: "/Users/sahilkathpal/code/grass-expo",
    outputFile: "_extracted-expo.md",
    topic: "expo-technical",
    description: "Grass mobile app technical context extracted from grass-expo codebase",
    consumers: ["strategist", "creator-evaluate", "creator-integrate", "creator-execute", "derivatives"],
    priority: 3,
  },
];

const STATE_PATH = resolve(import.meta.dirname, "../../data/extractor-state.json");
const CONTEXT_DIR = resolve(import.meta.dirname, "../context/grass");

// ── State ────────────────────────────────────────────────────────────────────

interface RepoState {
  path: string;
  lastCommitHash: string;
  lastRunAt: string;
}

interface ExtractorState {
  repos: Record<string, RepoState>;
}

function loadState(): ExtractorState {
  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { repos: {} };
  }
}

function saveState(state: ExtractorState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`  [extractor] State saved → ${STATE_PATH}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHeadCommit(repoPath: string): string {
  return execSync(`git -C "${repoPath}" rev-parse HEAD`, { encoding: "utf-8" }).trim();
}

function getGitDiff(repoPath: string, fromHash: string): string {
  return execSync(`git -C "${repoPath}" diff ${fromHash}..HEAD`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function wrapWithFrontMatter(
  body: string,
  meta: { topic: string; description: string; consumers: string[]; priority: number },
): string {
  return [
    "---",
    `topic: ${meta.topic}`,
    `description: ${meta.description}`,
    `consumers: ${meta.consumers.join(", ")}`,
    `priority: ${meta.priority}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const forceFullRun = process.argv.includes("--full");
  const state = loadState();

  console.log(`[extractor] Starting context extraction${forceFullRun ? " (--full)" : ""}...`);

  for (const repo of REPOS) {
    console.log(`\n[extractor] Processing ${repo.name}...`);

    if (!existsSync(repo.path)) {
      console.log(`  [extractor] Repo not found at ${repo.path}, skipping.`);
      continue;
    }

    const currentHash = getHeadCommit(repo.path);
    const prevState = state.repos[repo.name];
    const outputPath = resolve(CONTEXT_DIR, repo.outputFile);

    // Decide: full vs incremental vs skip
    if (!forceFullRun && prevState?.lastCommitHash === currentHash) {
      console.log(`  [extractor] No changes since ${currentHash.slice(0, 8)}, skipping.`);
      continue;
    }

    let extractedBody: string;

    if (forceFullRun || !prevState?.lastCommitHash || !existsSync(outputPath)) {
      // Full extraction
      console.log(`  [extractor] Collecting source files...`);
      const sourceCode = collectSourceFiles(repo.path);
      console.log(`  [extractor] Collected ${(sourceCode.length / 1024).toFixed(0)}KB of source code`);
      console.log(`  [extractor] Calling Claude for full extraction...`);
      extractedBody = await runFullExtraction(repo.name, sourceCode);
      console.log(`  [extractor] Got ${(extractedBody.length / 1024).toFixed(0)}KB response`);
    } else {
      // Incremental extraction
      const diff = getGitDiff(repo.path, prevState.lastCommitHash);
      if (!diff.trim()) {
        console.log(`  [extractor] Git diff is empty despite hash change, skipping.`);
        state.repos[repo.name] = { path: repo.path, lastCommitHash: currentHash, lastRunAt: new Date().toISOString() };
        continue;
      }
      const existingContext = readFileSync(outputPath, "utf-8");
      extractedBody = await runIncrementalExtraction(existingContext, diff);
    }

    // Write output
    const output = wrapWithFrontMatter(extractedBody, {
      topic: repo.topic,
      description: repo.description,
      consumers: repo.consumers,
      priority: repo.priority,
    });

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output);
    console.log(`  [extractor] Written → ${outputPath}`);

    // Update state
    state.repos[repo.name] = {
      path: repo.path,
      lastCommitHash: currentHash,
      lastRunAt: new Date().toISOString(),
    };
  }

  saveState(state);
  console.log("\n[extractor] Done.");
}

main().catch((err) => {
  console.error("[extractor] Fatal error:", err);
  process.exit(1);
});
