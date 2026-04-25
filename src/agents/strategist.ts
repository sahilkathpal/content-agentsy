import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DistributionPacketSchema,
  DroppedOpportunitySchema,
  StrategistOutputSchema,
  type DistributionPacket,
  type DroppedOpportunity,
  type StrategistOutput,
} from "../models/strategist-output.js";
import { ScoutOutputSchema, type ScoutOutput } from "../models/scout-output.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import { withConcurrency } from "../stages/scout.js";
import { z } from "zod";

const SYNDICATION_PLATFORMS: string[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../config/syndication-platforms.json"), "utf-8"),
);

const SurfaceResultSchema = z.object({
  packets: z.array(DistributionPacketSchema),
  dropped: z.array(DroppedOpportunitySchema),
});

type SurfaceResult = z.infer<typeof SurfaceResultSchema>;

const NotesResultSchema = z.object({
  strategy_notes: z.array(z.string()),
});

/* ------------------------------------------------------------------ */
/*  Map: process one surface                                          */
/* ------------------------------------------------------------------ */

async function processSurface(
  surface: ScoutOutput,
  grassContext: string,
  blogIndex: string,
): Promise<SurfaceResult> {
  const prompt = loadPrompt("strategist-surface", {
    grass_context: grassContext,
    surface_label: surface.surface_label,
    opportunities_count: String(surface.opportunities.length),
    scout_output_json: JSON.stringify(surface),
    blog_index: blogIndex,
    syndication_platforms: SYNDICATION_PLATFORMS.join(", "),
  });

  const text = await callClaude(prompt, "claude-sonnet-4-6", { maxTurns: 1 });
  const parsed = JSON.parse(extractJson(text));
  return SurfaceResultSchema.parse(parsed);
}

/* ------------------------------------------------------------------ */
/*  Notes: generate strategy observations from top packets            */
/* ------------------------------------------------------------------ */

async function generateNotes(packets: DistributionPacket[]): Promise<string[]> {
  const top = packets.slice(0, 15);
  const summary = top.map((p) => ({
    packet_id: p.packet_id,
    surface_label: p.surface_label,
    angle: p.angle,
    composite_score: p.composite_score,
    format: p.format,
    primary_channel: p.primary_channel,
  }));

  const prompt = loadPrompt("strategist-notes", {
    packets_summary: JSON.stringify(summary, null, 2),
  });

  const text = await callClaude(prompt, "claude-sonnet-4-6", { maxTurns: 1 });
  const parsed = JSON.parse(extractJson(text));
  return NotesResultSchema.parse(parsed).strategy_notes;
}

/* ------------------------------------------------------------------ */
/*  Main: map → reduce → notes → assemble                            */
/* ------------------------------------------------------------------ */

/**
 * Read combined scout output, process each surface independently,
 * merge and rank packets mechanically, then generate strategy notes.
 */
export async function runStrategist(
  scoutOutputPath: string,
  outPath: string,
  runId: string,
  blogIndex?: string,
): Promise<StrategistOutput | null> {
  const scoutOutputs: ScoutOutput[] = z
    .array(ScoutOutputSchema)
    .parse(JSON.parse(readFileSync(scoutOutputPath, "utf-8")));

  const totalOpportunities = scoutOutputs.reduce(
    (n, s) => n + s.opportunities.length,
    0,
  );

  if (totalOpportunities === 0) {
    console.log("  [strategist] no opportunities to analyze, skipping");
    return null;
  }

  console.log(
    `  [strategist] analyzing ${totalOpportunities} opportunities across ${scoutOutputs.length} surfaces (map-reduce)…`,
  );

  const grassContext = buildContextString(loadContextForConsumer("strategist"));
  const blogIdx = blogIndex && blogIndex.trim() ? blogIndex : "(none)";

  // ── Map: one Claude call per surface, 3 at a time ──
  const allPackets: DistributionPacket[] = [];
  const allDropped: DroppedOpportunity[] = [];

  await withConcurrency(scoutOutputs, 1, async (surface) => {
    try {
      const result = await processSurface(surface, grassContext, blogIdx);
      allPackets.push(...result.packets);
      allDropped.push(...result.dropped);
      console.log(
        `  [strategist] surface ${surface.surface_id}: ${result.packets.length} packets, ${result.dropped.length} dropped`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      console.warn(
        `  [strategist] ⚠ surface ${surface.surface_id} failed, skipping: ${msg}`,
      );
    }
  });

  if (allPackets.length === 0) {
    console.log("  [strategist] all surfaces produced 0 packets");
    return null;
  }

  // ── Reduce: sort by composite_score descending ──
  allPackets.sort((a, b) => b.composite_score - a.composite_score);

  // ── Notes: tiny Claude call for strategy observations ──
  let strategyNotes: string[];
  try {
    strategyNotes = await generateNotes(allPackets);
  } catch {
    strategyNotes = ["(strategy notes unavailable)"];
    console.warn("  [strategist] ⚠ strategy notes generation failed, using fallback");
  }

  // ── Assemble ──
  const now = new Date().toISOString();
  const output: StrategistOutput = StrategistOutputSchema.parse({
    run_id: runId,
    ranked_packets: allPackets,
    dropped: allDropped,
    strategy_notes: strategyNotes,
    analyzed_at: now,
  });

  console.log(
    `  [strategist] ${output.ranked_packets.length} packets ranked, ${output.dropped.length} dropped → ${outPath}`,
  );

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  return output;
}
