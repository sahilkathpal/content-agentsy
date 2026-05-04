/**
 * MCP tool definitions for the Editor agent.
 * Wraps the deterministic editorial logic from editorial-core.ts.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { NewsItemSchema } from "../models/digest.js";
import {
  prepareForEditor,
  buildEditorialDecision,
  type PreparedCluster,
  type EditorialJudgment,
} from "../agents/editorial-core.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const prepareClustersTool = tool(
  "prepare_clusters",
  "Phase 1 of editorial pipeline: hard-drop stale/meta items, cluster by URL similarity, enrich with signals. Call this first with the raw NewsItem array. Returns { prepared: PreparedCluster[], drop_count: number } JSON.",
  { items: z.array(NewsItemSchema) },
  async (args) => {
    const { prepared, dropCount } = prepareForEditor(args.items);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ prepared, drop_count: dropCount }),
      }],
    };
  },
);

const finalizeStoriesTool = tool(
  "finalize_stories",
  "Phase 3 of editorial pipeline: rank stories by newsworthiness, enforce source diversity, cap at 10. Call this AFTER evaluating all clusters. Input: the prepared clusters, your editorial judgments, total_raw count, and drop_count. Returns EditorialDecision JSON.",
  {
    prepared: z.array(z.any()),
    judgments: z.array(z.object({
      cluster_id: z.string(),
      include: z.boolean(),
      newsworthiness: z.enum(["must_tell", "solid", "filler", "skip"]),
      reasoning: z.string(),
      lead_angle: z.string(),
      category: z.enum(["launch", "update", "research", "drama", "tutorial", "benchmark", "opinion"]),
    })),
    total_raw: z.number(),
    drop_count: z.number(),
  },
  async (args) => {
    const decision = buildEditorialDecision(
      args.prepared as PreparedCluster[],
      args.judgments as EditorialJudgment[],
      args.total_raw,
      args.drop_count,
    );
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(decision),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

export const editorialMcpServer = createSdkMcpServer({
  name: "editorial-tools",
  tools: [prepareClustersTool, finalizeStoriesTool],
});

export const EDITORIAL_TOOL_NAMES = ["prepare_clusters", "finalize_stories"];
