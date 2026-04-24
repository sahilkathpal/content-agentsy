import { readFileSync, writeFileSync } from "node:fs";
import { StrategistOutputSchema, type DistributionPacket } from "./models/strategist-output.js";
import { CreatorOutputSchema, type CreatorOutput } from "./models/creator-output.js";
import { DerivativesOutputSchema, type DerivativesOutput } from "./models/derivatives-output.js";
import { SyndicationOutputSchema } from "./models/syndication-output.js";
import { PublisherOutputSchema } from "./models/publisher-output.js";
import { SyndicationPublisherOutputSchema } from "./models/syndication-publisher-output.js";
import type { AssetEntry } from "./models/asset-manifest.js";

/** Try to read + parse a JSON file, return null on failure */
function tryReadJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Build a manifest of all scorable assets from a pipeline run.
 *
 * Reads strategist output (identity fields), creator output (canonical asset),
 * and optionally derivatives, publisher, and syndication-publisher outputs
 * to produce one AssetEntry per scorable asset with published URLs filled in.
 */
export function buildManifest(
  strategistPath: string,
  creatorPath: string,
  derivativesPath?: string | null,
  publisherPath?: string | null,
  syndicationPublisherPath?: string | null,
  syndicationOutputPath?: string | null,
): AssetEntry[] {
  const strategistRaw = JSON.parse(readFileSync(strategistPath, "utf-8"));
  const strategistOutput = StrategistOutputSchema.parse(strategistRaw);

  const creatorRaw = JSON.parse(readFileSync(creatorPath, "utf-8"));
  const creator: CreatorOutput = CreatorOutputSchema.parse(creatorRaw);

  // Find the matching packet from strategist output
  const packet = strategistOutput.ranked_packets.find(
    (p) => p.packet_id === creator.packet_id,
  );

  if (!packet) {
    console.warn(
      `[manifest] No strategist packet found for packet_id="${creator.packet_id}"`,
    );
    return [];
  }

  // Load publisher output for canonical URL
  let canonicalUrl: string | null = null;
  let canonicalPublishedAt: string | null = null;
  if (publisherPath) {
    const pubRaw = tryReadJson(publisherPath);
    if (pubRaw) {
      try {
        const pub = PublisherOutputSchema.parse(pubRaw);
        // Build the real URL from slug (Ghost preview URLs use an ID, not the slug)
        const baseUrl = pub.ghost_post_url.replace(/\/blog\/.*$/, "");
        canonicalUrl = `${baseUrl}/blog/${pub.ghost_post_slug}/`;
        canonicalPublishedAt = pub.published_at;
      } catch { /* skip */ }
    }
  }

  // Load syndication publisher output for remote URLs
  const syndicationUrls = new Map<string, string>(); // platform → remote_url
  if (syndicationPublisherPath) {
    const synRaw = tryReadJson(syndicationPublisherPath);
    if (synRaw) {
      try {
        const synPub = SyndicationPublisherOutputSchema.parse(synRaw);
        for (const r of synPub.results) {
          if (r.remote_url && r.status === "published") {
            syndicationUrls.set(r.platform, r.remote_url);
          }
        }
      } catch { /* skip */ }
    }
  }

  const entries: AssetEntry[] = [];

  // 1. Canonical entry (blog)
  const canonical = buildCanonicalEntry(packet, creator);
  canonical.published_url = canonicalUrl;
  canonical.published_at = canonicalPublishedAt;
  entries.push(canonical);

  // 2. Syndication assets (from syndication-output.json if present, else fall back to derivatives-output.json)
  const syndicationAssetsSource = syndicationOutputPath ?? derivativesPath;
  if (syndicationAssetsSource) {
    try {
      const raw = JSON.parse(readFileSync(syndicationAssetsSource, "utf-8"));

      // Try new syndication-output.json format first, fall back to legacy derivatives-output.json
      let synAssets: Array<{ platform: string; title: string }> = [];
      const synParsed = SyndicationOutputSchema.safeParse(raw);
      if (synParsed.success) {
        synAssets = synParsed.data.assets;
      } else {
        const derivParsed = DerivativesOutputSchema.safeParse(raw);
        if (derivParsed.success) {
          synAssets = derivParsed.data.syndication_assets;
          for (const unit of (derivParsed.data as DerivativesOutput).native_units) {
            entries.push(buildNativeEntry(packet, unit.platform, creator.title));
          }
        }
      }

      for (const synAsset of synAssets) {
        const entry = buildSyndicationEntry(packet, synAsset.platform, synAsset.title);
        const platformKey = synAsset.platform === "dev_to" ? "dev.to" : synAsset.platform;
        const remoteUrl = syndicationUrls.get(platformKey);
        if (remoteUrl) entry.published_url = remoteUrl;
        entries.push(entry);
      }
    } catch (err) {
      console.warn(`[manifest] Could not read syndication assets: ${err}`);
    }
  }

  return entries;
}

function buildCanonicalEntry(
  packet: DistributionPacket,
  creator: CreatorOutput,
): AssetEntry {
  return {
    asset_id: `${packet.packet_id}__canonical__blog`,
    packet_id: packet.packet_id,
    surface_id: packet.surface_id,
    mode: creator.intent_mode,
    format: packet.format,
    voice_type: normalizeVoiceType(packet.voice_type),
    channel: "blog",
    asset_type: "canonical",
    title: creator.title,
    slug: creator.slug,
    published_url: null,
    published_at: null,
    geo_targets: creator.geo_targets,
  };
}

function buildSyndicationEntry(
  packet: DistributionPacket,
  platform: string,
  title: string,
): AssetEntry {
  const channel = normalizeChannel(platform);
  return {
    asset_id: `${packet.packet_id}__syndication__${channel}`,
    packet_id: packet.packet_id,
    surface_id: packet.surface_id,
    mode: packet.intent_mode as AssetEntry["mode"],
    format: packet.format,
    voice_type: normalizeVoiceType(packet.voice_type),
    channel,
    asset_type: "syndication",
    title,
    slug: "",
    published_url: null,
    published_at: null,
    geo_targets: [],
  };
}

function buildNativeEntry(
  packet: DistributionPacket,
  platform: string,
  canonicalTitle: string,
): AssetEntry {
  const channel = normalizeChannel(platform);
  return {
    asset_id: `${packet.packet_id}__participation__${channel}`,
    packet_id: packet.packet_id,
    surface_id: packet.surface_id,
    mode: packet.intent_mode as AssetEntry["mode"],
    format: packet.format,
    voice_type: normalizeVoiceType(packet.voice_type),
    channel,
    asset_type: "participation",
    title: canonicalTitle,
    slug: "",
    published_url: null,
    published_at: null,
    geo_targets: [],
  };
}

/** Map platform names to channel identifiers */
function normalizeChannel(platform: string): string {
  const map: Record<string, string> = {
    dev_to: "dev_to",
    hashnode: "hashnode",
    hackernoon: "hackernoon",
    x_twitter: "x",
    linkedin: "linkedin",
    reddit: "reddit",
  };
  return map[platform.toLowerCase()] ?? platform.toLowerCase();
}

/** Map free-form voice_type strings to the enum values */
function normalizeVoiceType(raw: string): AssetEntry["voice_type"] {
  const valid = [
    "brand_canonical",
    "engineer_voice",
    "founder_operator_voice",
    "contributor_voice",
    "community_voice",
  ];
  return valid.includes(raw) ? raw as AssetEntry["voice_type"] : "brand_canonical";
}

/**
 * Build manifest and write to disk. Returns the entries.
 */
export function buildAndWriteManifest(
  strategistPath: string,
  creatorPath: string,
  outPath: string,
  derivativesPath?: string | null,
  publisherPath?: string | null,
  syndicationPublisherPath?: string | null,
  syndicationOutputPath?: string | null,
): AssetEntry[] {
  const entries = buildManifest(
    strategistPath, creatorPath, derivativesPath,
    publisherPath, syndicationPublisherPath, syndicationOutputPath,
  );
  writeFileSync(outPath, JSON.stringify(entries, null, 2));
  console.log(`  [manifest] ${entries.length} asset(s) → ${outPath}`);
  return entries;
}
