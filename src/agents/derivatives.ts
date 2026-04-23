import { readFileSync, writeFileSync } from "node:fs";
import {
  DerivativesOutputSchema,
  type DerivativesOutput,
  type SyndicationAsset,
  type NativeUnit,
} from "../models/derivatives-output.js";
import { CreatorOutputSchema } from "../models/creator-output.js";
import { StrategistOutputSchema } from "../models/strategist-output.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import { config } from "../config.js";
import { z } from "zod";

/**
 * Generate derivative content (syndication assets + native units)
 * from a canonical blog post and its distribution packet.
 */
export async function runDerivatives(
  creatorPath: string,
  strategistPath: string,
  outPath: string,
  packetId?: string,
  canonicalUrl?: string
): Promise<DerivativesOutput | null> {
  // Load creator output
  const creatorOutput = CreatorOutputSchema.parse(
    JSON.parse(readFileSync(creatorPath, "utf-8"))
  );

  // Load strategist output and find the matching packet
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

  // Run syndication and native unit calls
  let syndicationAssets: SyndicationAsset[] = [];
  let nativeUnits: NativeUnit[] = [];

  // Call 1 — Syndication (if targets exist)
  if (packet.syndication_targets.length > 0) {
    syndicationAssets = await generateSyndication(creatorOutput, packet, canonicalUrl);
  } else {
    console.log("  [derivatives] no syndication targets, skipping");
  }

  // Call 2 — Native units (if targets exist)
  if (packet.native_units.length > 0) {
    nativeUnits = await generateNativeUnits(creatorOutput, packet);
  } else {
    console.log("  [derivatives] no native unit targets, skipping");
  }

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

async function generateSyndication(
  creatorOutput: z.infer<typeof CreatorOutputSchema>,
  packet: z.infer<typeof import("../models/strategist-output.js").DistributionPacketSchema>,
  canonicalUrl?: string
): Promise<SyndicationAsset[]> {
  try {
    console.log(
      `  [derivatives] calling Claude for syndication (${packet.syndication_targets.length} targets)…`
    );

    const grassContext = buildContextString(loadContextForConsumer("derivatives"));

    const prompt = loadPrompt("derivatives-syndication", {
      grass_context: grassContext,
      canonical_title: creatorOutput.title,
      canonical_slug: creatorOutput.slug,
      meta_description: creatorOutput.meta_description,
      voice_type: packet.voice_type,
      syndication_targets_json: JSON.stringify(packet.syndication_targets, null, 2),
      canonical_markdown: creatorOutput.canonical_markdown,
      canonical_url: canonicalUrl ?? `${config.ghostUrl.replace(/\/+$/, "")}/blog/${creatorOutput.slug}`,
    });

    const text = await callClaude(prompt, "claude-sonnet-4-6");

    const parsed = JSON.parse(extractJson(text));
    const assets = z.array(
      z.object({
        platform: z.string(),
        title: z.string(),
        frontmatter: z.record(z.union([z.string(), z.boolean(), z.number(), z.array(z.string())])),
        markdown: z.string(),
        canonical_url_backlink: z.string(),
      })
    ).parse(parsed);

    console.log(`  [derivatives] syndication: ${assets.length} assets generated`);
    return assets;
  } catch (err) {
    console.warn("  [derivatives] syndication call failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function generateNativeUnits(
  creatorOutput: z.infer<typeof CreatorOutputSchema>,
  packet: z.infer<typeof import("../models/strategist-output.js").DistributionPacketSchema>
): Promise<NativeUnit[]> {
  try {
    console.log(
      `  [derivatives] calling Claude for native units (${packet.native_units.length} targets)…`
    );

    // Condense the canonical markdown to key points for native prompt size
    const condensed = condenseCanonical(creatorOutput.canonical_markdown);

    const grassContext = buildContextString(loadContextForConsumer("derivatives"));

    const prompt = loadPrompt("derivatives-native", {
      grass_context: grassContext,
      canonical_title: creatorOutput.title,
      canonical_slug: creatorOutput.slug,
      angle: packet.angle,
      friction: packet.friction,
      outcome: packet.outcome,
      native_units_json: JSON.stringify(packet.native_units, null, 2),
      canonical_markdown: condensed,
    });

    const text = await callClaude(prompt, "claude-sonnet-4-6");

    const parsed = JSON.parse(extractJson(text));
    const units = z.array(z.any()).parse(parsed);

    // Validate each unit individually so one bad unit doesn't kill the batch
    const validated: NativeUnit[] = [];
    for (const unit of units) {
      try {
        if (unit.platform === "x_twitter") {
          validated.push(
            z.object({
              platform: z.literal("x_twitter"),
              segments: z.array(
                z.object({
                  position: z.number(),
                  text: z.string(),
                  has_link: z.boolean(),
                })
              ),
              hook: z.string(),
              thread_cta: z.string(),
            }).parse(unit)
          );
        } else if (unit.platform === "linkedin") {
          validated.push(
            z.object({
              platform: z.literal("linkedin"),
              text: z.string(),
              hook_line: z.string(),
              canonical_link: z.string(),
              hashtags: z.array(z.string()),
            }).parse(unit)
          );
        } else {
          console.warn(`  [derivatives] unknown native unit platform: ${unit.platform}, skipping`);
        }
      } catch (err) {
        console.warn(`  [derivatives] failed to validate native unit for ${unit.platform}:`, err instanceof Error ? err.message : String(err));
      }
    }

    console.log(`  [derivatives] native units: ${validated.length} units generated`);
    return validated;
  } catch (err) {
    console.warn("  [derivatives] native units call failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Condense a canonical markdown post to its key points for native unit prompts.
 * Extracts TL;DR, headings, and first paragraph under each heading.
 */
function condenseCanonical(markdown: string): string {
  const lines = markdown.split("\n");
  const condensed: string[] = [];
  let inTldr = false;
  let paragraphCount = 0;

  for (const line of lines) {
    // Capture TL;DR section
    if (/^#+\s.*tl;?dr/i.test(line)) {
      inTldr = true;
      condensed.push(line);
      continue;
    }

    if (inTldr) {
      if (/^#+\s/.test(line)) {
        inTldr = false;
      } else {
        condensed.push(line);
        continue;
      }
    }

    // Capture all headings
    if (/^#+\s/.test(line)) {
      condensed.push(line);
      paragraphCount = 0;
      continue;
    }

    // Capture first non-empty paragraph after each heading
    if (line.trim() && paragraphCount === 0) {
      condensed.push(line);
      paragraphCount++;
    }
  }

  return condensed.join("\n");
}
