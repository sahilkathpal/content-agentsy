import { readFileSync } from "node:fs";
import type { SyndicationAsset } from "../models/derivatives-output.js";
import { CreatorOutputSchema } from "../models/creator-output.js";
import { StrategistOutputSchema, type DistributionPacket } from "../models/strategist-output.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import { config } from "../config.js";
import { z } from "zod";

/**
 * Generate syndication assets (platform-specific markdown reformats)
 * from a canonical blog post. These are reformats, not rewrites — the voice,
 * structure, and content stay faithful to the canonical post.
 *
 * Currently targets: Dev.to, Hashnode.
 */
export async function runSyndicationGenerator(
  creatorPath: string,
  strategistPath: string,
  packetId?: string,
  canonicalUrl?: string
): Promise<SyndicationAsset[]> {
  const creatorOutput = CreatorOutputSchema.parse(
    JSON.parse(readFileSync(creatorPath, "utf-8"))
  );

  const strategistOutput = StrategistOutputSchema.parse(
    JSON.parse(readFileSync(strategistPath, "utf-8"))
  );

  const targetPacketId = packetId ?? creatorOutput.packet_id;
  const packet = strategistOutput.ranked_packets.find(
    (p) => p.packet_id === targetPacketId
  );

  if (!packet) {
    console.log(`  [syndication-generator] packet "${targetPacketId}" not found in strategist output`);
    return [];
  }

  if (packet.syndication_targets.length === 0) {
    console.log("  [syndication-generator] no syndication targets, skipping");
    return [];
  }

  return generateSyndication(creatorOutput, packet, canonicalUrl);
}

async function generateSyndication(
  creatorOutput: z.infer<typeof CreatorOutputSchema>,
  packet: DistributionPacket,
  canonicalUrl?: string
): Promise<SyndicationAsset[]> {
  try {
    console.log(
      `  [syndication-generator] calling Claude for syndication (${packet.syndication_targets.length} targets)…`
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

    const text = await callClaude(prompt, "claude-haiku-4-5", { maxTurns: 1 });

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

    console.log(`  [syndication-generator] ${assets.length} syndication assets generated`);
    return assets;
  } catch (err) {
    console.warn("  [syndication-generator] syndication call failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}
