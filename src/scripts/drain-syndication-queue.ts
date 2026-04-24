import { resolve, dirname } from "node:path";
import "dotenv/config";
import { dequeue, queueLength } from "../syndication-queue.js";
import { runSyndicationPublisher } from "../agents/syndication-publisher.js";

/**
 * Drain the syndication queue, publishing up to --limit items (default: 2).
 *
 * Usage: npx tsx src/scripts/drain-syndication-queue.ts [--limit N]
 */
async function main() {
  const args = process.argv.slice(2);
  let limit = 2;
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = Number(args[limitIdx + 1]);
  }

  const total = queueLength();
  if (total === 0) {
    console.log("[drain] Queue is empty — nothing to publish");
    return;
  }

  console.log(`[drain] Queue has ${total} item(s) — publishing up to ${limit}`);

  const batch = dequeue(limit);

  for (const item of batch) {
    console.log(`[drain] Publishing ${item.packet_id} (enqueued ${item.enqueued_at})`);
    try {
      const packetDir = dirname(item.syndication_path);
      const outPath = resolve(packetDir, "syndication-publisher-output.json");
      await runSyndicationPublisher(item.syndication_path, outPath, item.canonical_url);
    } catch (err) {
      console.error(
        `[drain] Failed to publish ${item.packet_id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const remaining = queueLength();
  console.log(`[drain] Done. ${remaining} item(s) remaining in queue.`);
}

main().catch((err) => {
  console.error("[drain] Fatal:", err);
  process.exit(1);
});
