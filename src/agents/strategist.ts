import { readFileSync, writeFileSync } from "node:fs";
import { StrategistOutputSchema, type StrategistOutput } from "../models/strategist-output.js";
import { ScoutOutputSchema, type ScoutOutput } from "../models/scout-output.js";
import { callClaude } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import { z } from "zod";

/**
 * Read combined scout output, call Claude to rank opportunities into
 * distribution packets, write output to disk and return it.
 */
export async function runStrategist(
  scoutOutputPath: string,
  outPath: string,
  runId: string,
  blogIndex?: string
): Promise<StrategistOutput | null> {
  const scoutOutputs: ScoutOutput[] = z.array(ScoutOutputSchema).parse(
    JSON.parse(readFileSync(scoutOutputPath, "utf-8"))
  );

  const totalOpportunities = scoutOutputs.reduce(
    (n, s) => n + s.opportunities.length,
    0
  );

  if (totalOpportunities === 0) {
    console.log("  [strategist] no opportunities to analyze, skipping");
    return null;
  }

  console.log(
    `  [strategist] analyzing ${totalOpportunities} opportunities across ${scoutOutputs.length} surfaces…`
  );

  const now = new Date().toISOString();

  const grassContext = buildContextString(loadContextForConsumer("strategist"));

  const prompt = loadPrompt("strategist", {
    grass_context: grassContext,
    run_id: runId,
    surfaces_count: String(scoutOutputs.length),
    opportunities_count: String(totalOpportunities),
    scout_output_json: JSON.stringify(scoutOutputs, null, 2),
    analyzed_at: now,
    blog_index: blogIndex && blogIndex.trim() ? blogIndex : "(none)",
  });

  const text = await callClaude(prompt, "claude-sonnet-4-6");

  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const output = StrategistOutputSchema.parse(parsed);

    console.log(
      `  [strategist] ${output.ranked_packets.length} packets ranked, ${output.dropped.length} dropped → ${outPath}`
    );

    writeFileSync(outPath, JSON.stringify(output, null, 2));
    return output;
  } catch (err) {
    const snippet = text.slice(0, 500);
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[strategist] Failed to parse Claude response: ${errMsg}\nRaw response (first 500 chars): ${snippet}`
    );
  }
}
