import { spawn } from "node:child_process";

export interface CallClaudeOpts {
  maxRetries?: number;
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
      return await callClaudeOnce(prompt, model);
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

function callClaudeOnce(prompt: string, model?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const args = ["-p", "--output-format", "text", "--max-turns", "5"];
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
