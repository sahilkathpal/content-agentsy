import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { DerivativesOutputSchema, type SyndicationAsset } from "../models/derivatives-output.js";
import type { PlatformResult, SyndicationPublisherOutput } from "../models/syndication-publisher-output.js";

/**
 * Publish a syndication asset to Dev.to as a draft article.
 * Uses the Forem REST API: POST /api/articles
 */
async function publishToDevTo(asset: SyndicationAsset, apiKey: string): Promise<PlatformResult> {
  // Dev.to tags: comma-separated string, max 4 tags
  const rawTags = asset.frontmatter.tags;
  let tags: string;
  if (Array.isArray(rawTags)) {
    tags = rawTags.slice(0, 4).join(",");
  } else if (typeof rawTags === "string") {
    tags = rawTags.split(",").slice(0, 4).join(",");
  } else {
    tags = "";
  }

  const description =
    typeof asset.frontmatter.description === "string"
      ? asset.frontmatter.description
      : "";

  const body = {
    article: {
      title: asset.title,
      body_markdown: asset.markdown,
      published: false,
      tags,
      canonical_url: asset.canonical_url_backlink,
      description,
    },
  };

  console.log(`[syndication-publisher] Dev.to → creating draft: "${asset.title}"`);

  const resp = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.warn(`[syndication-publisher] Dev.to API error ${resp.status}: ${text}`);
    return {
      platform: "dev.to",
      status: "failed",
      remote_id: null,
      remote_url: null,
      error: `HTTP ${resp.status}: ${text}`,
    };
  }

  const data = (await resp.json()) as { id: number; url: string };
  console.log(`[syndication-publisher] Dev.to draft created → ${data.url}`);

  return {
    platform: "dev.to",
    status: "draft_created",
    remote_id: String(data.id),
    remote_url: data.url,
    error: null,
  };
}

/**
 * Publish a syndication asset to Hashnode as a draft.
 * Uses the Hashnode GraphQL API: createDraft mutation.
 */
async function publishToHashnode(
  asset: SyndicationAsset,
  pat: string,
  publicationId: string
): Promise<PlatformResult> {
  // Build tag slugs from frontmatter
  const rawTags = asset.frontmatter.tags;
  let tagSlugs: Array<{ slug: string }> = [];
  if (Array.isArray(rawTags)) {
    tagSlugs = rawTags.map((t) => ({ slug: String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
  } else if (typeof rawTags === "string") {
    tagSlugs = rawTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ slug: t.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
  }

  // Derive slug from title
  const slug = asset.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const mutation = `
    mutation CreateDraft($input: CreateDraftInput!) {
      createDraft(input: $input) {
        draft {
          id
          title
          slug
        }
      }
    }
  `;

  const variables = {
    input: {
      title: asset.title,
      contentMarkdown: asset.markdown,
      publicationId,
      slug,
      originalArticleURL: asset.canonical_url_backlink,
      tags: tagSlugs,
    },
  };

  console.log(`[syndication-publisher] Hashnode → creating draft: "${asset.title}"`);

  const resp = await fetch("https://gql.hashnode.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: pat,
    },
    body: JSON.stringify({ query: mutation, variables }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.warn(`[syndication-publisher] Hashnode API error ${resp.status}: ${text}`);
    return {
      platform: "hashnode",
      status: "failed",
      remote_id: null,
      remote_url: null,
      error: `HTTP ${resp.status}: ${text}`,
    };
  }

  const data = (await resp.json()) as {
    data?: { createDraft?: { draft?: { id: string; title: string; slug: string } } };
    errors?: Array<{ message: string }>;
  };

  if (data.errors?.length) {
    const errMsg = data.errors.map((e) => e.message).join("; ");
    console.warn(`[syndication-publisher] Hashnode GraphQL error: ${errMsg}`);
    return {
      platform: "hashnode",
      status: "failed",
      remote_id: null,
      remote_url: null,
      error: errMsg,
    };
  }

  const draft = data.data?.createDraft?.draft;
  if (!draft) {
    return {
      platform: "hashnode",
      status: "failed",
      remote_id: null,
      remote_url: null,
      error: "No draft returned from Hashnode API",
    };
  }

  console.log(`[syndication-publisher] Hashnode draft created → ${draft.id}`);

  return {
    platform: "hashnode",
    status: "draft_created",
    remote_id: draft.id,
    remote_url: null, // Hashnode drafts don't have public URLs
    error: null,
  };
}

/**
 * Read derivatives output and publish syndication assets to Dev.to and Hashnode as drafts.
 * No LLM call — pure API integration.
 */
export async function runSyndicationPublisher(
  derivativesPath: string,
  outPath: string,
  canonicalUrlOverride?: string
): Promise<SyndicationPublisherOutput | null> {
  const raw = JSON.parse(readFileSync(derivativesPath, "utf-8"));
  const derivatives = DerivativesOutputSchema.parse(raw);

  if (canonicalUrlOverride) {
    for (const asset of derivatives.syndication_assets) {
      asset.canonical_url_backlink = canonicalUrlOverride;
      if ("canonical_url" in asset.frontmatter) asset.frontmatter.canonical_url = canonicalUrlOverride;
      if ("canonical"     in asset.frontmatter) asset.frontmatter.canonical     = canonicalUrlOverride;
    }
  }

  const results: PlatformResult[] = [];

  const devtoApiKey = config.devtoApiKey;
  const hashnodePat = config.hashnodePat;
  const hashnodePublicationId = config.hashnodePublicationId;

  // Find dev.to syndication asset
  const devtoAsset = derivatives.syndication_assets.find(
    (a) => a.platform.toLowerCase().replace(/[^a-z.]/g, "") === "dev.to"
  );

  if (devtoAsset) {
    if (devtoApiKey) {
      const result = await publishToDevTo(devtoAsset, devtoApiKey);
      results.push(result);
    } else {
      console.log("[syndication-publisher] No DEVTO_API_KEY set — skipping Dev.to");
      results.push({
        platform: "dev.to",
        status: "skipped",
        remote_id: null,
        remote_url: null,
        error: "DEVTO_API_KEY not configured",
      });
    }
  }

  // Find hashnode syndication asset
  const hashnodeAsset = derivatives.syndication_assets.find(
    (a) => a.platform.toLowerCase().includes("hashnode")
  );

  if (hashnodeAsset) {
    if (hashnodePat && hashnodePublicationId) {
      const result = await publishToHashnode(hashnodeAsset, hashnodePat, hashnodePublicationId);
      results.push(result);
    } else {
      const missing = [
        !hashnodePat && "HASHNODE_PAT",
        !hashnodePublicationId && "HASHNODE_PUBLICATION_ID",
      ].filter(Boolean).join(", ");
      console.log(`[syndication-publisher] Missing ${missing} — skipping Hashnode`);
      results.push({
        platform: "hashnode",
        status: "skipped",
        remote_id: null,
        remote_url: null,
        error: `Missing env: ${missing}`,
      });
    }
  }

  if (results.length === 0) {
    console.log("[syndication-publisher] No dev.to or hashnode syndication assets found in derivatives");
    return null;
  }

  const output: SyndicationPublisherOutput = {
    packet_id: derivatives.packet_id,
    results,
    created_at: new Date().toISOString(),
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));

  const created = results.filter((r) => r.status === "draft_created").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`[syndication-publisher] Done: ${created} created, ${skipped} skipped, ${failed} failed`);

  return output;
}
