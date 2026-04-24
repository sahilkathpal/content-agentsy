import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCreator } from "../agents/creator.js";
import { searchAuthorityLinks } from "../sources/authority-search.js";
import { SignalSchema } from "../models/signal.js";
import type { PipelineContext } from "../pipeline.js";
import { withConcurrency } from "./scout.js";
import { z } from "zod";

/**
 * Creator stage: loops over top-N packets, runs authority search + creator for each.
 * Writes packet-N/creator-output.json per packet.
 */
export async function runCreatorStage(ctx: PipelineContext): Promise<void> {
  const strategistOutPath = resolve(ctx.runDir, "strategist-output.json");
  const scoutOutputPath = resolve(ctx.runDir, "scout-output.json");

  const strategistRaw = JSON.parse(readFileSync(strategistOutPath, "utf-8"));
  const packets = strategistRaw.ranked_packets ?? [];

  // Filter to blog channel by default (this is the canonical blog pipeline)
  const channel = ctx.opts.channel ?? "blog";
  const filteredPackets = packets.filter(
    (p: { primary_channel: string }) => p.primary_channel === channel,
  );

  const packetIds: string[] = ctx.opts.packetId
    ? [ctx.opts.packetId]
    : ctx.opts.topN > 0
      ? filteredPackets.slice(0, ctx.opts.topN).map((p: { packet_id: string }) => p.packet_id)
      : filteredPackets.map((p: { packet_id: string }) => p.packet_id);

  if (packetIds.length === 0) {
    throw new Error("No packets to process (check --channel / --packet / --top-n)");
  }

  if (ctx.blogIndex) {
    console.log(`  ${ctx.blogIndex.split("\n").length} existing posts available for cross-linking`);
  }

  let successCount = 0;
  const concurrency = ctx.opts.maxConcurrent ?? 2;
  const indexedPackets = packetIds.map((id, i) => ({ id, i }));

  await withConcurrency(indexedPackets, concurrency, async ({ id: pktId, i }) => {
    const packetDir = resolve(ctx.runDir, `packet-${i + 1}`);
    mkdirSync(packetDir, { recursive: true });

    console.log(`\n${"~".repeat(50)}`);
    console.log(`Packet ${i + 1}/${packetIds.length}: ${pktId}`);
    console.log("~".repeat(50));

    // Authority links
    const pkt = packets.find((p: { packet_id: string }) => p.packet_id === pktId);
    let authorityLinksStr: string | undefined;
    let sourceLinksStr: string | undefined;
    if (pkt) {
      console.log("  [authority-search] Finding authoritative external sources...");
      const authorityLinks = await searchAuthorityLinks(
        pkt.surface_id,
        pkt.angle ?? pkt.format,
      );
      console.log(`  [authority-search] Found ${authorityLinks.length} authority links`);
      if (authorityLinks.length > 0) {
        authorityLinksStr = authorityLinks
          .map((l: { title: string; url: string; domain: string; excerpts: string[] }) =>
            `- [${l.title}](${l.url}) (${l.domain})\n  ${l.excerpts[0] ?? ""}`)
          .join("\n");
        writeFileSync(resolve(packetDir, "authority-links.json"), JSON.stringify(authorityLinks, null, 2));
      }

      // Source links from scout signals
      try {
        const signalsPath = resolve(ctx.runDir, pkt.surface_id, "signals.json");
        const signals = z.array(SignalSchema).parse(
          JSON.parse(readFileSync(signalsPath, "utf-8"))
        );
        const withUrls = signals.filter((s) => s.url);
        if (withUrls.length > 0) {
          sourceLinksStr = withUrls
            .map((s) => `- [${s.title}](${s.url}) (${s.source})`)
            .join("\n");
          console.log(`  [source-links] ${withUrls.length} source URLs from scout signals`);
        }
      } catch {
        console.warn("  [source-links] could not load signals for source link extraction");
      }
    }

    // Creator
    console.log("\n--- Running creator ---");
    const creatorOutPath = resolve(packetDir, "creator-output.json");
    const creatorOutput = await runCreator(
      strategistOutPath,
      scoutOutputPath,
      creatorOutPath,
      pktId,
      ctx.blogIndex,
      authorityLinksStr,
      sourceLinksStr,
    );

    if (creatorOutput) {
      successCount++;
      console.log(`\nCanonical post created:`);
      console.log(`  Title: ${creatorOutput.title}`);
      console.log(`  Slug: ${creatorOutput.slug}`);
      console.log(`  Words: ${creatorOutput.word_count}`);
      console.log(`  Intent: ${creatorOutput.intent_mode}`);
      console.log(`  GEO targets: ${creatorOutput.geo_targets.length}`);
      console.log(`  Proof artifacts used: ${creatorOutput.proof_artifacts_used.length}`);
      if (creatorOutput.external_links_used?.length) {
        console.log(`  External links used: ${creatorOutput.external_links_used.length}`);
      }
    } else {
      console.log(`  [creator] no output for packet ${pktId}`);
    }
  });

  if (successCount === 0) {
    throw new Error("Creator produced no output for any packet");
  }
}
