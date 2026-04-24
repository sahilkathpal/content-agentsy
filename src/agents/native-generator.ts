import { readFileSync } from "node:fs";
import type { NativeUnit } from "../models/derivatives-output.js";
import { CreatorOutputSchema } from "../models/creator-output.js";
import { StrategistOutputSchema, type DistributionPacket } from "../models/strategist-output.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import { z } from "zod";

/**
 * Generate platform-native content (X threads, LinkedIn posts)
 * from a canonical blog post. These are original content pieces
 * tailored to each platform's voice and format, not reformats.
 */
export async function runNativeGenerator(
  creatorPath: string,
  strategistPath: string,
  packetId?: string,
): Promise<NativeUnit[]> {
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
    console.log(`  [native-generator] packet "${targetPacketId}" not found in strategist output`);
    return [];
  }

  if (packet.native_units.length === 0) {
    console.log("  [native-generator] no native unit targets, skipping");
    return [];
  }

  return generateNativeUnits(creatorOutput, packet);
}

async function generateNativeUnits(
  creatorOutput: z.infer<typeof CreatorOutputSchema>,
  packet: DistributionPacket,
): Promise<NativeUnit[]> {
  try {
    console.log(
      `  [native-generator] calling Claude for native units (${packet.native_units.length} targets)…`
    );

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

    const text = await callClaude(prompt, "claude-haiku-4-5", { maxTurns: 1 });

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
          console.warn(`  [native-generator] unknown native unit platform: ${unit.platform}, skipping`);
        }
      } catch (err) {
        console.warn(`  [native-generator] failed to validate native unit for ${unit.platform}:`, err instanceof Error ? err.message : String(err));
      }
    }

    console.log(`  [native-generator] ${validated.length} native units generated`);
    return validated;
  } catch (err) {
    console.warn("  [native-generator] native units call failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Condense a canonical markdown post to its key points for native unit prompts.
 * Extracts TL;DR, headings, and first paragraph under each heading.
 */
export function condenseCanonical(markdown: string): string {
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
