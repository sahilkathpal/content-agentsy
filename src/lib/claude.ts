import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";

export interface CallClaudeOpts {
  maxRetries?: number;
  maxTurns?: number;
  allowedTools?: string[];
  addDirs?: string[];
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
 * Call Claude via the Agent SDK and return the text response.
 * Retries transient failures with exponential backoff.
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
        const delay = Math.pow(2, retryNum) * 1000;
        console.log(
          `  [claude] Retry ${retryNum + 1}/${maxRetries} after ${delay}ms: ${err instanceof Error ? err.message.slice(0, 100) : err}`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return attempt(retryNum + 1);
      }
      throw err;
    }
  }

  return attempt(0);
}

async function callClaudeOnce(
  prompt: string,
  model?: string,
  opts?: CallClaudeOpts,
): Promise<string> {
  const hasTools = (opts?.allowedTools?.length ?? 0) > 0;

  for await (const msg of query({
    prompt,
    options: {
      model,
      maxTurns: opts?.maxTurns ?? 5,
      // When tools are specified: make them available and auto-allow them.
      // When no tools needed: disable all built-in tools to keep calls lean.
      tools: hasTools ? opts!.allowedTools! : [],
      allowedTools: opts?.allowedTools ?? [],
      additionalDirectories: opts?.addDirs ?? [],
      persistSession: false,
    },
  })) {
    if (msg.type === "result") {
      if (msg.is_error) {
        const subtype = (msg as { subtype?: string }).subtype ?? "unknown";
        throw new Error(`Claude error: ${subtype}`);
      }
      return (msg as SDKResultSuccess).result;
    }
  }

  throw new Error("No result message received from Claude");
}
