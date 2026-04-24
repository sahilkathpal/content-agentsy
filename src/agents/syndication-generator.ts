import { readFileSync } from "node:fs";
import type { SyndicationAsset } from "../models/derivatives-output.js";
import { CreatorOutputSchema, type CreatorOutput } from "../models/creator-output.js";
import { StrategistOutputSchema, type DistributionPacket } from "../models/strategist-output.js";
import { config } from "../config.js";

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
  canonicalUrl?: string,
  tags?: string[]
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

  const canonical = canonicalUrl
    ?? `${config.ghostUrl.replace(/\/blog\/ghost\/?$|\/ghost\/?$/, "").replace(/\/+$/, "")}/blog/${creatorOutput.slug}/`;

  const resolvedTags = tags ?? deriveTags(creatorOutput);
  const assets = buildSyndicationAssets(creatorOutput, packet, canonical, resolvedTags);
  console.log(`  [syndication-generator] ${assets.length} syndication assets built`);
  return assets;
}

function buildSyndicationAssets(
  creator: CreatorOutput,
  packet: DistributionPacket,
  canonicalUrl: string,
  tags: string[]
): SyndicationAsset[] {
  return packet.syndication_targets.map((platform) => {
    switch (platform) {
      case "dev.to":    return buildDevTo(creator, canonicalUrl, tags);
      case "hashnode":  return buildHashnode(creator, canonicalUrl, tags);
      default:          return buildGeneric(platform, creator, canonicalUrl, tags);
    }
  });
}

function deriveTags(creator: CreatorOutput): string[] {
  if (!creator.topic_tag) return [];
  // topic_tag may be comma-separated; normalise to lowercase slugs
  return creator.topic_tag
    .split(/[,/]/)
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);
}

function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^#[^\n]*\n+/, "");
}

function backlink(canonicalUrl: string): string {
  return `\n\n---\n*Originally published at [codeongrass.com](${canonicalUrl})*`;
}

function buildDevTo(creator: CreatorOutput, canonicalUrl: string, tags: string[]): SyndicationAsset {
  return {
    platform: "dev.to",
    title: creator.title,
    frontmatter: {
      title: creator.title,
      tags: tags.slice(0, 4),
      canonical_url: canonicalUrl,
      cover_image: "",
    },
    markdown: stripLeadingH1(creator.canonical_markdown) + backlink(canonicalUrl),
    canonical_url_backlink: canonicalUrl,
  };
}

function buildHashnode(creator: CreatorOutput, canonicalUrl: string, tags: string[]): SyndicationAsset {
  return {
    platform: "hashnode",
    title: creator.title,
    frontmatter: {
      title: creator.title,
      slug: creator.slug,
      tags: tags.slice(0, 5),
      canonical: canonicalUrl,
      enableTableOfContents: true,
    },
    markdown: stripLeadingH1(creator.canonical_markdown) + backlink(canonicalUrl),
    canonical_url_backlink: canonicalUrl,
  };
}

function buildGeneric(platform: string, creator: CreatorOutput, canonicalUrl: string, tags: string[]): SyndicationAsset {
  return {
    platform,
    title: creator.title,
    frontmatter: {
      title: creator.title,
      tags,
      canonical_url: canonicalUrl,
    },
    markdown: stripLeadingH1(creator.canonical_markdown) + backlink(canonicalUrl),
    canonical_url_backlink: canonicalUrl,
  };
}
