import { readFileSync, writeFileSync } from "node:fs";
import { CreatorOutputSchema, type CreatorOutput } from "../models/creator-output.js";
import { StrategistOutputSchema } from "../models/strategist-output.js";
import { ScoutOutputSchema, type ScoutOutput } from "../models/scout-output.js";
import { callClaude } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { loadContextForConsumer, buildContextString } from "../context/load-context.js";
import { z } from "zod";

/**
 * Read strategist output, pick a distribution packet, load scout signals
 * for evidence, call Claude to write a GEO-optimized canonical blog post,
 * validate output, and write to disk.
 */
export async function runCreator(
  strategistPath: string,
  scoutOutputPath: string,
  outPath: string,
  packetId?: string,
  blogIndex?: string,
  authorityLinks?: string,
  sourceLinks?: string
): Promise<CreatorOutput | null> {
  const strategistOutput = StrategistOutputSchema.parse(
    JSON.parse(readFileSync(strategistPath, "utf-8"))
  );

  if (strategistOutput.ranked_packets.length === 0) {
    console.log("  [creator] no distribution packets available, skipping");
    return null;
  }

  // Pick packet by id or take the top-ranked one
  const packet = packetId
    ? strategistOutput.ranked_packets.find((p) => p.packet_id === packetId)
    : strategistOutput.ranked_packets[0];

  if (!packet) {
    console.log(`  [creator] packet "${packetId}" not found in strategist output`);
    return null;
  }

  console.log(
    `  [creator] writing canonical post for packet: ${packet.packet_id} (${packet.intent_mode}, ${packet.format}, grass_role=${packet.grass_role})`
  );

  // Load scout signals for evidence context
  const scoutOutputs: ScoutOutput[] = z.array(ScoutOutputSchema).parse(
    JSON.parse(readFileSync(scoutOutputPath, "utf-8"))
  );

  // Find the scout output for this packet's surface and collect referenced signals
  const surfaceScout = scoutOutputs.find((s) => s.surface_id === packet.surface_id);
  const relevantSignals = surfaceScout
    ? JSON.stringify(surfaceScout, null, 2)
    : "No scout signals available for this surface.";

  const now = new Date().toISOString();

  // Load Grass product context for brand integration (role-filtered)
  const consumerKey = `creator-${packet.grass_role}`;
  const grassContext = buildContextString(loadContextForConsumer(consumerKey));

  const prompt = loadPrompt("creator", {
    grass_context: grassContext,
    grass_role: packet.grass_role,
    packet_json: JSON.stringify(packet, null, 2),
    scout_signals_json: relevantSignals,
    intent_mode: packet.intent_mode,
    surface_id: packet.surface_id,
    created_at: now,
    blog_index: blogIndex || "(no existing posts yet)",
    authority_links: authorityLinks || "(no external authority links available)",
    source_links: sourceLinks || "(no source links available)",
  });

  const text = await callClaude(prompt, "claude-sonnet-4-6");

  try {
    const jsonMarker = "---JSON---";
    const markdownMarker = "---MARKDOWN---";
    const jsonStart = text.indexOf(jsonMarker);
    const markdownStart = text.indexOf(markdownMarker);

    let parsed: Record<string, unknown>;
    if (jsonStart !== -1 && markdownStart !== -1 && markdownStart > jsonStart) {
      const jsonSection = text.slice(jsonStart + jsonMarker.length, markdownStart).trim()
        .replace(/^```(?:json)?\s*\n?/m, "")
        .replace(/\n?```\s*$/m, "")
        .trim();
      const markdownSection = text.slice(markdownStart + markdownMarker.length).trim();
      parsed = JSON.parse(jsonSection);
      parsed.canonical_markdown = markdownSection;
    } else {
      // Fallback: try parsing as raw JSON (legacy format)
      const cleaned = text
        .replace(/^```(?:json)?\s*\n?/m, "")
        .replace(/\n?```\s*$/m, "")
        .trim();
      parsed = JSON.parse(cleaned);
    }

    const output = CreatorOutputSchema.parse(parsed);

    console.log(
      `  [creator] "${output.title}" — ${output.word_count} words, ${output.geo_targets.length} GEO targets → ${outPath}`
    );

    writeFileSync(outPath, JSON.stringify(output, null, 2));
    return output;
  } catch (err) {
    console.warn("  [creator] failed to parse Claude response:", err);
    console.warn(`  Raw response (first 500 chars): ${text.slice(0, 500)}`);
    return null;
  }
}
