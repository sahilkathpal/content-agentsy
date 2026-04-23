import { resolve } from "node:path";
import { runStrategist } from "../agents/strategist.js";
import type { PipelineContext } from "../pipeline.js";

/**
 * Strategist stage: reads scout output, produces ranked distribution packets.
 */
export async function runStrategistStage(ctx: PipelineContext): Promise<void> {
  const scoutOutputPath = resolve(ctx.runDir, "scout-output.json");
  const strategistOutPath = resolve(ctx.runDir, "strategist-output.json");

  const strategistOutput = await runStrategist(
    scoutOutputPath,
    strategistOutPath,
    ctx.runId,
    ctx.blogIndex,
  );

  if (!strategistOutput || strategistOutput.ranked_packets.length === 0) {
    throw new Error("Strategist produced no distribution packets");
  }

  console.log(`\nTop distribution packets:`);
  for (const pkt of strategistOutput.ranked_packets.slice(0, 10)) {
    console.log(
      `  [${pkt.composite_score.toFixed(1)}] ${pkt.packet_id}: ${pkt.format} -> ${pkt.primary_channel} (${pkt.intent_mode}, ${pkt.grass_role})`,
    );
  }
  if (strategistOutput.dropped.length > 0) {
    console.log(`\nDropped ${strategistOutput.dropped.length} opportunities:`);
    for (const d of strategistOutput.dropped) {
      console.log(`  x ${d.opportunity_id}: ${d.reason}`);
    }
  }
  if (strategistOutput.strategy_notes.length > 0) {
    console.log(`\nStrategy notes:`);
    for (const note of strategistOutput.strategy_notes) {
      console.log(`  - ${note}`);
    }
  }
}
