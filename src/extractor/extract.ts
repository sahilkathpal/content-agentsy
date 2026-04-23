import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, extname } from "node:path";
import { callClaude } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";

const EXTENSIONS = new Set([".ts", ".tsx", ".json", ".md"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".expo", "android", "ios", "build"]);
const MAX_PAYLOAD_BYTES = 200_000;

/**
 * Recursively collect source files from a repo, concatenated with path headers.
 */
export function collectSourceFiles(repoPath: string): string {
  const chunks: string[] = [];
  let totalSize = 0;

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!EXTENSIONS.has(extname(entry.name))) continue;

      const stat = statSync(full);
      if (totalSize + stat.size > MAX_PAYLOAD_BYTES) continue;

      const content = readFileSync(full, "utf-8");
      const rel = relative(repoPath, full);
      chunks.push(`=== ${rel} ===\n${content}\n`);
      totalSize += stat.size;
    }
  }

  walk(repoPath);
  return chunks.join("\n");
}

/**
 * Run a full extraction: send entire codebase to LLM.
 */
export async function runFullExtraction(repoName: string, sourceCode: string): Promise<string> {
  const prompt = loadPrompt("extract-full", { repo_name: repoName, source_code: sourceCode });
  console.log(`  [extractor] Running full extraction for ${repoName} (${(sourceCode.length / 1024).toFixed(0)}KB payload)...`);
  return callClaude(prompt, "claude-sonnet-4-6");
}

/**
 * Run an incremental extraction: send existing context + git diff to LLM.
 */
export async function runIncrementalExtraction(existingContext: string, gitDiff: string): Promise<string> {
  const prompt = loadPrompt("extract-update", { existing_context: existingContext, git_diff: gitDiff });
  console.log(`  [extractor] Running incremental extraction (${(gitDiff.length / 1024).toFixed(0)}KB diff)...`);
  return callClaude(prompt, "claude-sonnet-4-6");
}
