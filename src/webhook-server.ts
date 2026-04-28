import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config, requireKey, webhookPort } from "./config.js";
import { runSyndicationGenerator } from "./agents/syndication-generator.js";
import { enqueue } from "./syndication-queue.js";
import { PublisherOutputSchema } from "./models/publisher-output.js";
import { SyndicationOutputSchema, type SyndicationOutput } from "./models/syndication-output.js";
import type { SyndicationAsset } from "./models/derivatives-output.js";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

function writeDerivativesPreviews(
  syndicationAssets: SyndicationAsset[],
  runDir: string
): void {
  const previewDir = resolve(runDir, "derivatives-preview");
  mkdirSync(previewDir, { recursive: true });

  for (const asset of syndicationAssets) {
    const frontmatterLines = Object.entries(asset.frontmatter)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
      .join("\n");
    const content = `---\n${frontmatterLines}\ncanonical_url: ${asset.canonical_url_backlink}\n---\n\n# ${asset.title}\n\n${asset.markdown}\n`;
    const filename = `syndication-${asset.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}.md`;
    writeFileSync(resolve(previewDir, filename), content);
  }


  console.log(`  [webhook-server] derivative previews written → ${previewDir}`);
}

const inFlightSet = new Set<string>();

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function verifyGhostSignature(body: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;

  // Parse: sha256=<hex>, t=<timestamp>
  const shaMatch = header.match(/sha256=([0-9a-f]+)/);
  const tMatch   = header.match(/t=(\d+)/);
  if (!shaMatch || !tMatch) return false;

  const expectedHex = shaMatch[1];
  const timestamp   = Number(tMatch[1]);

  // Replay guard: reject if timestamp is more than 5 minutes off
  // Ghost sends timestamp in milliseconds (Date.now()), not seconds
  if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    console.warn("[webhook-server] signature timestamp too far from now — possible replay");
    return false;
  }

  // Ghost signs body + timestamp, not body alone
  const hmac     = createHmac("sha256", secret).update(body + tMatch[1]).digest();
  const expected = Buffer.from(expectedHex, "hex");
  if (hmac.length !== expected.length) return false;

  return timingSafeEqual(hmac, expected);
}

function findPacketDir(ghostPostId: string): { packetDir: string; publisherOutput: ReturnType<typeof PublisherOutputSchema.parse> } | null {
  const runsDir = resolve(new URL(".", import.meta.url).pathname, "../data/runs");

  let entries: string[];
  try {
    entries = readdirSync(runsDir).sort().reverse().slice(0, 20);
  } catch {
    console.warn("[webhook-server] data/runs dir not found");
    return null;
  }

  for (const entry of entries) {
    const entryDir = resolve(runsDir, entry);

    // Check root-level publisher-output.json
    const rootPublisherPath = resolve(entryDir, "publisher-output.json");
    if (existsSync(rootPublisherPath)) {
      try {
        const raw = JSON.parse(readFileSync(rootPublisherPath, "utf-8"));
        const parsed = PublisherOutputSchema.parse(raw);
        if (parsed.ghost_post_id === ghostPostId) {
          return { packetDir: entryDir, publisherOutput: parsed };
        }
      } catch { /* not a match */ }
    }

    // Check packet-*/publisher-output.json
    let subs: string[];
    try {
      subs = readdirSync(entryDir);
    } catch { continue; }

    for (const sub of subs) {
      if (!sub.startsWith("packet-")) continue;
      const subDir = resolve(entryDir, sub);
      const subPublisherPath = resolve(subDir, "publisher-output.json");
      if (!existsSync(subPublisherPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(subPublisherPath, "utf-8"));
        const parsed = PublisherOutputSchema.parse(raw);
        if (parsed.ghost_post_id === ghostPostId) {
          return { packetDir: subDir, publisherOutput: parsed };
        }
      } catch { /* not a match */ }
    }
  }

  return null;
}

async function processInBackground(
  ghostPostId: string,
  packetDir: string,
  publisherOutput: ReturnType<typeof PublisherOutputSchema.parse>,
  creatorPath: string,
  strategistPath: string,
  ghostPostUrl: string,
  publishedAt: string,
): Promise<void> {
  try {
    console.log(`[webhook-server] generating syndication assets for packet ${publisherOutput.packet_id}`);
    const syndicationAssets = await runSyndicationGenerator(
      creatorPath, strategistPath, publisherOutput.packet_id, ghostPostUrl,
      publisherOutput.tags.length > 0 ? publisherOutput.tags : undefined
    );

    // Write syndication-output.json
    const syndicationOutputPath = resolve(packetDir, "syndication-output.json");
    const syndicationOutput: SyndicationOutput = SyndicationOutputSchema.parse({
      packet_id: publisherOutput.packet_id,
      canonical_slug: publisherOutput.ghost_post_slug,
      canonical_url: ghostPostUrl ?? "",
      assets: syndicationAssets,
      created_at: new Date().toISOString(),
    });
    writeFileSync(syndicationOutputPath, JSON.stringify(syndicationOutput, null, 2));

    // Write preview files
    writeDerivativesPreviews(syndicationAssets, packetDir);

    // Enqueue syndication assets for rate-limited publishing
    enqueue({
      packet_id: publisherOutput.packet_id,
      syndication_path: syndicationOutputPath,
      canonical_url: ghostPostUrl ?? "",
    });

    // Update publisher-output.json with published status
    const publisherOutPath = resolve(packetDir, "publisher-output.json");
    publisherOutput.status       = "published";
    publisherOutput.published_at = publishedAt;
    writeFileSync(publisherOutPath, JSON.stringify(publisherOutput, null, 2));

    console.log(`[webhook-server] done for packet ${publisherOutput.packet_id}`);
  } catch (err) {
    console.error("[webhook-server] background processing error:", err);
  } finally {
    inFlightSet.delete(ghostPostId);
  }
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Only handle POST /webhook/ghost
  if (req.method !== "POST" || req.url !== "/webhook/ghost") {
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return;
  }

  const body = await collectBody(req);

  // Verify signature (always required in production)
  const webhookSecret = requireKey("ghostWebhookSecret");
  const sigHeader = req.headers["x-ghost-signature"] as string | undefined;
  if (!verifyGhostSignature(body, sigHeader, webhookSecret)) {
    res.writeHead(401).end(JSON.stringify({ error: "invalid signature" }));
    return;
  }

  let payload: { post?: { current?: Record<string, unknown> } };
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400).end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  const post = payload.post?.current;
  if (!post || post.status !== "published") {
    res.writeHead(200).end(JSON.stringify({ status: "ignored", reason: "not a published post" }));
    return;
  }

  const ghostPostId  = String(post.id);
  const ghostPostUrl = String(post.url);
  const publishedAt  = post.published_at ? String(post.published_at) : new Date().toISOString();

  console.log(`[webhook-server] post.published: ${ghostPostId} → ${ghostPostUrl}`);

  if (inFlightSet.has(ghostPostId)) {
    res.writeHead(200).end(JSON.stringify({ status: "in_progress" }));
    return;
  }

  const found = findPacketDir(ghostPostId);
  if (!found) {
    console.warn(`[webhook-server] no packet dir found for ghost_post_id=${ghostPostId}`);
    res.writeHead(404).end(JSON.stringify({ error: "packet not found for this post id" }));
    return;
  }

  const { packetDir, publisherOutput } = found;

  // Idempotency: already processed
  const syndicationOutPath = resolve(packetDir, "syndication-publisher-output.json");
  if (existsSync(syndicationOutPath)) {
    res.writeHead(200).end(JSON.stringify({ status: "already_done", packet_id: publisherOutput.packet_id }));
    return;
  }

  const creatorPath = resolve(packetDir, "creator-output.json");
  if (!existsSync(creatorPath)) {
    res.writeHead(422).end(JSON.stringify({ error: "creator-output.json not found in packet dir" }));
    return;
  }

  const strategistPath = publisherOutput.strategist_output_path;
  if (!strategistPath || !existsSync(strategistPath)) {
    res.writeHead(422).end(JSON.stringify({ error: "strategist_output_path missing or file not found" }));
    return;
  }

  // Respond 202 immediately so Ghost doesn't time out (2s limit),
  // then process syndication in the background
  inFlightSet.add(ghostPostId);
  res.writeHead(202).end(JSON.stringify({
    status: "accepted",
    packet_id:      publisherOutput.packet_id,
    ghost_post_url: ghostPostUrl,
  }));

  processInBackground(ghostPostId, packetDir, publisherOutput, creatorPath, strategistPath, ghostPostUrl, publishedAt);
}

export function startServer(): void {
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      await handleWebhook(req, res);
    } catch (err) {
      console.error("[webhook-server] unhandled error in request handler:", err);
      if (!res.headersSent) {
        res.writeHead(500).end(JSON.stringify({ error: "internal error" }));
      }
    }
  });

  server.listen(webhookPort, () => {
    console.log(`[webhook-server] listening on port ${webhookPort}`);
  });

  // Graceful shutdown: stop accepting new connections and drain in-flight requests
  function shutdown(signal: string) {
    console.log(`[webhook-server] ${signal} received, shutting down gracefully...`);
    server.close(() => {
      console.log("[webhook-server] all connections drained, exiting");
      process.exit(0);
    });
    // Force exit after 10s if connections won't drain
    setTimeout(() => {
      console.error("[webhook-server] forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
