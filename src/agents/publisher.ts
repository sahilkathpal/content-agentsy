import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { marked } from "marked";
import { config } from "../config.js";
import { callClaude, extractJson } from "../claude.js";
import { CreatorOutputSchema, type CreatorOutput } from "../models/creator-output.js";
import type { PublisherOutput } from "../models/publisher-output.js";

/**
 * Parse the ## FAQ section from canonical markdown.
 * Returns an array of { question, answer } pairs, or empty array if none found.
 */
function parseFaqSection(markdown: string): Array<{ question: string; answer: string }> {
  const faqMatch = markdown.match(/^##\s+(?:FAQ|Frequently Asked Questions)\s*\n([\s\S]*)/im);
  if (!faqMatch) return [];

  const faqBody = faqMatch[1];
  const entries: Array<{ question: string; answer: string }> = [];
  const blocks = faqBody.split(/^###\s+/m).filter(Boolean);

  for (const block of blocks) {
    const newline = block.indexOf("\n");
    if (newline === -1) continue;
    const question = block.slice(0, newline).trim();
    const answer = block.slice(newline).trim();
    if (question && answer) {
      entries.push({ question, answer });
    }
  }

  return entries;
}

/**
 * Build a BlogPosting JSON-LD schema object for the canonical post.
 */
function buildBlogPostingSchema(creator: CreatorOutput, siteUrl: string, siteName: string) {
  const base = siteUrl.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: creator.title,
    description: creator.meta_description,
    url: `${base}/${creator.slug}/`,
    datePublished: creator.created_at,
    keywords: creator.geo_targets,
    author: {
      "@type": "Organization",
      name: siteName,
      url: base,
    },
    publisher: {
      "@type": "Organization",
      name: siteName,
      url: base,
    },
  };
}

/**
 * Build the Ghost tags array for a post.
 * Returns 3 tags: topic (from surface_label or surface_id), content type (from intent_mode), and
 * the internal #pipeline marker.
 */
function buildTags(creator: CreatorOutput): Array<{ name: string }> {
  const intentTagMap: Record<string, string> = {
    M0_RESOLVE: "explainer",
    M1_EVALUATE: "comparison",
    M2_EXECUTE: "guide",
  };
  const topicTag = creator.surface_label
    ? creator.surface_label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    : creator.surface_id.replace(/^rotating_/, "").replace(/_/g, "-");
  return [
    { name: topicTag },
    { name: intentTagMap[creator.intent_mode] ?? creator.intent_mode },
    { name: "#pipeline" },
  ];
}

/**
 * Locate the strategist-output.json relative to the creator output path.
 * In the full pipeline, creator lives in packet-N/ and strategist is one level up.
 * In creator-only mode, they are siblings in the same directory.
 */
function findStrategistPath(creatorPath: string): string | null {
  const sibling = join(dirname(creatorPath), "strategist-output.json");
  if (existsSync(sibling)) return sibling;
  const parent = join(dirname(dirname(creatorPath)), "strategist-output.json");
  if (existsSync(parent)) return parent;
  return null;
}

/**
 * Extract format and voice_type tags from the strategist output for the matching packet.
 * Returns empty array if the strategist file can't be found or parsed.
 */
function tagsFromStrategist(creatorPath: string, packetId: string): Array<{ name: string }> {
  const strategistPath = findStrategistPath(creatorPath);
  if (!strategistPath) return [];
  try {
    const strategist = JSON.parse(readFileSync(strategistPath, "utf-8"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const packet = strategist.ranked_packets?.find((p: any) => p.packet_id === packetId);
    if (!packet) return [];
    const tags: Array<{ name: string }> = [];
    if (packet.format) tags.push({ name: (packet.format as string).replace(/\s+/g, "-") });
    if (packet.voice_type) tags.push({ name: (packet.voice_type as string).replace(/_/g, "-") });
    return tags;
  } catch {
    return [];
  }
}

/**
 * Call Claude to extract brand/product/tool names from the canonical markdown.
 * Returns up to 8 tag objects, or empty array on any failure.
 */
async function extractBrandTags(markdown: string): Promise<Array<{ name: string }>> {
  try {
    const template = readFileSync(
      new URL("../prompts/brand-extractor.md", import.meta.url),
      "utf-8"
    );
    const prompt = template.replace("{{canonical_markdown}}", markdown);
    const text = await callClaude(prompt, "claude-haiku-4-5", { maxTurns: 1 });
    const parsed = JSON.parse(extractJson(text)) as { brands: string[] };
    const brands = (parsed.brands ?? []).slice(0, 8);
    console.log(`[publisher] Brand tags extracted: ${brands.join(", ")}`);
    return brands.map((b) => ({ name: b }));
  } catch {
    console.warn("[publisher] Brand extraction failed — skipping");
    return [];
  }
}

/**
 * Build a Ghost Admin API JWT from the `id:secret` key format.
 * Uses Node built-in crypto — no jsonwebtoken dependency needed.
 */
function buildGhostJwt(adminKey: string): string {
  const [id, secret] = adminKey.split(":");
  if (!id || !secret) throw new Error("GHOST_ADMIN_KEY must be in id:secret format");

  const keyBuf = Buffer.from(secret, "hex");

  const header = { alg: "HS256", typ: "JWT", kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 300, aud: "/admin/" };

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const input = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac("sha256", keyBuf).update(input).digest("base64url");

  return `${input}.${signature}`;
}

/**
 * Publish a creator-output.json canonical post to Ghost as a draft.
 * Returns the publisher output or null on failure.
 */
export async function runPublisher(
  creatorPath: string,
  outPath: string
): Promise<PublisherOutput | null> {
  const ghostUrl = config.ghostUrl;
  const ghostAdminKey = config.ghostAdminKey;
  const siteName = config.siteName || "Grass";

  if (!ghostUrl || !ghostAdminKey) {
    console.warn("[publisher] Missing GHOST_URL or GHOST_ADMIN_KEY — skipping");
    return null;
  }

  // Read and validate creator output
  const raw = JSON.parse(readFileSync(creatorPath, "utf-8"));
  const creator: CreatorOutput = CreatorOutputSchema.parse(raw);

  // Strip leading H1 title line — Ghost renders the post title separately
  const strippedMarkdown = creator.canonical_markdown.replace(/^#\s+.+\n?/, "").trimStart();

  // Inject FAQPage JSON-LD schema before converting to HTML
  const faqItems = parseFaqSection(strippedMarkdown);
  let markdown = strippedMarkdown;

  if (faqItems.length > 0) {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      })),
    };
    markdown += `\n\n<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;
    console.log(`[publisher] Injecting FAQPage schema (${faqItems.length} Q&A pairs)`);
  }

  // Inject BlogPosting JSON-LD schema
  const blogPostingSchema = buildBlogPostingSchema(creator, ghostUrl, siteName);
  markdown += `\n\n<script type="application/ld+json">\n${JSON.stringify(blogPostingSchema, null, 2)}\n</script>`;
  console.log(`[publisher] Injecting BlogPosting schema`);

  // Convert markdown to HTML
  const html = await marked.parse(markdown);

  // Build full tag set: base + strategist + brands
  const strategistTags = tagsFromStrategist(creatorPath, creator.packet_id);
  const brandTags = await extractBrandTags(creator.canonical_markdown);
  const tags = [...buildTags(creator), ...strategistTags, ...brandTags];

  // Build JWT
  const token = buildGhostJwt(ghostAdminKey);

  // POST to Ghost Admin API
  // Wrap HTML in Lexical JSON envelope (Ghost 5+ uses Lexical editor)
  const lexical = JSON.stringify({
    root: {
      children: [{ type: "html", version: 1, html }],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });

  const apiUrl = `${ghostUrl.replace(/\/+$/, "")}/api/admin/posts/`;
  const body = {
    posts: [
      {
        title: creator.title,
        slug: creator.slug,
        lexical,
        meta_description: creator.meta_description,
        og_title: creator.title,
        og_description: creator.meta_description,
        twitter_title: creator.title,
        twitter_description: creator.meta_description,
        ...(creator.custom_excerpt ? { custom_excerpt: creator.custom_excerpt } : {}),
        tags,
        status: "draft" as const,
      },
    ],
  };

  console.log(`[publisher] Creating draft: "${creator.title}"`);

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Ghost ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.warn(`[publisher] Ghost API error ${resp.status}: ${text}`);
    return null;
  }

  const data = (await resp.json()) as {
    posts: Array<{
      id: string;
      url: string;
      slug: string;
      created_at: string;
    }>;
  };

  const post = data.posts[0];
  const output: PublisherOutput = {
    packet_id: creator.packet_id,
    surface_id: creator.surface_id,
    title: creator.title,
    ghost_post_id: post.id,
    ghost_post_url: post.url,
    ghost_post_slug: post.slug,
    status: "draft",
    published_at: null,
    created_at: post.created_at,
    pipeline_created_at: new Date().toISOString(),
    run_dir: "",
    strategist_output_path: "",
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`[publisher] Draft created → ${post.url}`);

  return output;
}
