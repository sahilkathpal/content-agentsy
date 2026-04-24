import { readFileSync, writeFileSync } from "node:fs";
import {
  DerivativesOutputSchema,
  type DerivativesOutput,
  type SyndicationAsset,
  type NativeUnit,
} from "../models/derivatives-output.js";
import { CreatorOutputSchema } from "../models/creator-output.js";
import { StrategistOutputSchema } from "../models/strategist-output.js";
import { runSyndicationGenerator } from "./syndication-generator.js";
import { runNativeGenerator } from "./native-generator.js";

/**
 * Generate derivative content (syndication assets + native units)
 * from a canonical blog post and its distribution packet.
 *
 * Thin orchestrator that delegates to the syndication-generator
 * and native-generator agents in parallel.
 */
export async function runDerivatives(
  creatorPath: string,
  strategistPath: string,
  outPath: string,
  packetId?: string,
  canonicalUrl?: string
): Promise<DerivativesOutput | null> {
  // Load creator output for metadata
  const creatorOutput = CreatorOutputSchema.parse(
    JSON.parse(readFileSync(creatorPath, "utf-8"))
  );

  // Load strategist output to check packet exists
  const strategistOutput = StrategistOutputSchema.parse(
    JSON.parse(readFileSync(strategistPath, "utf-8"))
  );

  const targetPacketId = packetId ?? creatorOutput.packet_id;
  const packet = strategistOutput.ranked_packets.find(
    (p) => p.packet_id === targetPacketId
  );

  if (!packet) {
    console.log(
      `  [derivatives] packet "${targetPacketId}" not found in strategist output`
    );
    return null;
  }

  console.log(
    `  [derivatives] generating derivatives for: ${creatorOutput.title}`
  );

  // Run syndication and native unit generation in parallel
  const [syndicationAssets, nativeUnits] = await Promise.all([
    runSyndicationGenerator(creatorPath, strategistPath, packetId, canonicalUrl),
    runNativeGenerator(creatorPath, strategistPath, packetId),
  ]);

  // Assemble output
  const now = new Date().toISOString();
  const output: DerivativesOutput = DerivativesOutputSchema.parse({
    packet_id: targetPacketId,
    surface_id: creatorOutput.surface_id,
    canonical_title: creatorOutput.title,
    canonical_slug: creatorOutput.slug,
    syndication_assets: syndicationAssets,
    native_units: nativeUnits,
    generation_stats: {
      syndication_count: syndicationAssets.length,
      native_unit_count: nativeUnits.length,
    },
    created_at: now,
  });

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(
    `  [derivatives] ${syndicationAssets.length} syndication assets, ${nativeUnits.length} native units → ${outPath}`
  );

  return output;
}
