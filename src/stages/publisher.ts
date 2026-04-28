import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPublisher } from "../agents/publisher.js";
import { runNativePublisher } from "../agents/native-publisher.js";
import { buildAndWriteManifest } from "../manifest.js";
import type { PipelineContext } from "../pipeline.js";

/**
 * Publisher stage: loops over packet-N directories with creator output,
 * publishes each to Ghost as draft, then builds a manifest.
 */
export async function runPublisherStage(ctx: PipelineContext): Promise<void> {
  const strategistOutPath = resolve(ctx.runDir, "strategist-output.json");

  // Find all packet-* directories with creator-output.json
  const entries = readdirSync(ctx.runDir).filter((e) => e.startsWith("packet-")).sort();

  if (entries.length === 0) {
    throw new Error("No packet directories found. Run creator stage first.");
  }

  let publishedCount = 0;

  for (const packetEntry of entries) {
    const packetDir = resolve(ctx.runDir, packetEntry);
    const creatorOutPath = resolve(packetDir, "creator-output.json");

    // Skip packets without creator output
    try {
      readFileSync(creatorOutPath);
    } catch {
      console.log(`  Skipping ${packetEntry}: no creator-output.json`);
      continue;
    }

    console.log(`\n--- Publishing ${packetEntry} ---`);

    // Publish to Ghost
    const publisherOutPath = resolve(packetDir, "publisher-output.json");
    const publisherOutput = await runPublisher(creatorOutPath, publisherOutPath);

    if (publisherOutput) {
      publishedCount++;
      // Attach run metadata
      publisherOutput.run_dir = ctx.runDir;
      publisherOutput.strategist_output_path = strategistOutPath;
      writeFileSync(publisherOutPath, JSON.stringify(publisherOutput, null, 2));

      console.log(`\nGhost draft published:`);
      console.log(`  Post ID: ${publisherOutput.ghost_post_id}`);
      console.log(`  URL: ${publisherOutput.ghost_post_url}`);
      console.log(`  Slug: ${publisherOutput.ghost_post_slug}`);
      console.log(`  Status: ${publisherOutput.status}`);
    }

    // Publish native units (X thread, LinkedIn) to Typefully as drafts
    const derivativesOutPath = resolve(packetDir, "derivatives-output.json");
    const nativePublisherOutPath = resolve(packetDir, "native-publisher-output.json");
    try {
      readFileSync(derivativesOutPath);
      console.log(`\n--- Publishing native units for ${packetEntry} ---`);
      const nativeResult = await runNativePublisher(derivativesOutPath, nativePublisherOutPath);
      if (nativeResult) {
        for (const r of nativeResult.results) {
          if (r.status === "drafted") {
            console.log(`  Typefully draft (${r.platform}): ${r.draft_url ?? r.draft_id}`);
          }
        }
      }
    } catch {
      // No derivatives output — skip native publishing
    }

    // Build manifest
    const manifestOutPath = resolve(packetDir, "manifest.json");
    const pubOutPath = resolve(packetDir, "publisher-output.json");
    const tryReadPath = (p: string) => { try { readFileSync(p); return p; } catch { return null; } };
    buildAndWriteManifest(
      strategistOutPath,
      creatorOutPath,
      manifestOutPath,
      tryReadPath(derivativesOutPath),
      tryReadPath(pubOutPath),
      null, // syndication-publisher
      null, // syndication-output
      tryReadPath(nativePublisherOutPath),
    );
  }

  if (publishedCount === 0) {
    throw new Error("Publisher failed to publish any packets");
  }

  console.log(`\nPublished ${publishedCount}/${entries.length} packets`);
}
