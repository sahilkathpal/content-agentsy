import { spawn } from "node:child_process";

export interface CallClaudeOpts {
  maxRetries?: number;
  maxTurns?: number;
}

/**
 * Extract JSON content from a Claude response that may contain:
 * - A conversational preamble before a ```json fence
 * - A plain ```json...``` or ``` ``` fence with no preamble
 * - Raw JSON with no fence at all
 *
 * Strategy:
 *   1. Look for the FIRST ```json or ``` fence and capture everything inside it.
 *   2. If no fence found, slice from the first `{` or `[` in the response.
 */
export function extractJson(text: string): string {
  // Prefer explicit ```json fence
  const jsonFence = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (jsonFence) return jsonFence[1].trim();

  // Fall back to plain ``` fence with no language tag (skip ```bash, ```ts, etc.)
  const plainFence = text.match(/```\s*\n([\s\S]*?)\n?```/);
  if (plainFence) return plainFence[1].trim();
  // Fallback: find first structural character
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  if (firstBrace === -1 && firstBracket === -1) {
    return text.trim(); // let JSON.parse fail with original text
  }
  const start =
    firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket);
  return text.slice(start).trim();
}

/**
 * Call Claude Code CLI with a prompt and return the text response.
 * Uses spawn to stream the prompt via stdin, avoiding EPIPE on large payloads.
 * Retries transient failures (non-zero exit codes) with exponential backoff.
 */
export function callClaude(
  prompt: string,
  model?: string,
  opts?: CallClaudeOpts,
): Promise<string> {
  const maxRetries = opts?.maxRetries ?? 2;

  async function attempt(retryNum: number): Promise<string> {
    try {
      return await callClaudeOnce(prompt, model, opts);
    } catch (err) {
      if (retryNum < maxRetries) {
        const delay = Math.pow(2, retryNum) * 1000; // 1s, 2s, 4s...
        console.log(`  [claude] Retry ${retryNum + 1}/${maxRetries} after ${delay}ms: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
        await new Promise((r) => setTimeout(r, delay));
        return attempt(retryNum + 1);
      }
      throw err;
    }
  }

  return attempt(0);
}

function callClaudeOnce(prompt: string, model?: string, opts?: CallClaudeOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const args = ["-p", "--output-format", "text", "--max-turns", String(opts?.maxTurns ?? 5)];
    if (model) args.push("--model", model);

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`claude CLI spawn failed: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.on("error", () => {});
    child.stdin.write(prompt, () => {
      child.stdin.end();
    });
  });
}
