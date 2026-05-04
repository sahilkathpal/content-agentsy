import { extractJson } from "../claude.js";
import { runAgent } from "./runner.js";
import { researchMcpServer, RESEARCH_TOOL_NAMES } from "../tools/research-tools.js";
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

  const prompt =
    "Research today's coding agent news. Call all available fetch tools (fetch_github_releases, fetch_official_rss, fetch_hn, fetch_x_viral, fetch_github_velocity, fetch_github_trending, fetch_curated_rss, fetch_reddit), combine all results into one array, then call deduplicate_and_filter. Return only the JSON array from deduplicate_and_filter.";

  const text = await runAgent({
    agentId: "researcher",
    prompt,
    mcpServer: researchMcpServer,
    serverName: "research-tools",
    toolNames: RESEARCH_TOOL_NAMES,
    maxTurns: 20,
  });

  const parsed = JSON.parse(extractJson(text));

  if (!Array.isArray(parsed)) {
    throw new Error(`Researcher did not return an array; got: ${typeof parsed}`);
  }

  const items = z.array(NewsItemSchema).parse(parsed);
  console.log(`  [researcher] collected ${items.length} fresh items`);
  return items;
}
