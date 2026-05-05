import { extractJson } from "../claude.js";
import { runAgent } from "./runner.js";
import { researchMcpServer } from "../tools/research-tools.js";
import { NewsItemSchema, type NewsItem } from "../models/digest.js";
import { z } from "zod";

/**
 * Researcher agent: collects coding agent news using Claude-driven tool calls.
 *
 * Claude calls each source fetch tool, combines results, then calls
 * deduplicate_and_filter to return a clean NewsItem[].
 */
export async function researchNews(): Promise<NewsItem[]> {
  console.log("  [researcher] starting agent — Claude will call source tools…");

  const text = await runAgent({
    agentId: "researcher",
    prompt: `Today: ${new Date().toISOString().slice(0, 10)}`,
    mcpServer: researchMcpServer,
  });

  const parsed = JSON.parse(extractJson(text));

  if (!Array.isArray(parsed)) {
    throw new Error(`Researcher did not return an array; got: ${typeof parsed}`);
  }

  const items = z.array(NewsItemSchema).parse(parsed);
  console.log(`  [researcher] collected ${items.length} fresh items`);
  return items;
}
