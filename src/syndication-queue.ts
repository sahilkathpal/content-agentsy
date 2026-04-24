import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const QUEUE_PATH = resolve(import.meta.dirname, "../data/syndication-queue.json");

export interface SyndicationQueueItem {
  packet_id: string;
  syndication_path: string;
  canonical_url: string;
  enqueued_at: string;
}

function readQueue(): SyndicationQueueItem[] {
  if (!existsSync(QUEUE_PATH)) return [];
  return JSON.parse(readFileSync(QUEUE_PATH, "utf-8")) as SyndicationQueueItem[];
}

function writeQueue(items: SyndicationQueueItem[]): void {
  writeFileSync(QUEUE_PATH, JSON.stringify(items, null, 2));
}

export function enqueue(item: Omit<SyndicationQueueItem, "enqueued_at">): void {
  const queue = readQueue();
  queue.push({ ...item, enqueued_at: new Date().toISOString() });
  writeQueue(queue);
  console.log(`[syndication-queue] enqueued ${item.packet_id} (queue length: ${queue.length})`);
}

/**
 * Remove and return the first n items from the queue.
 */
export function dequeue(n: number): SyndicationQueueItem[] {
  const queue = readQueue();
  if (queue.length === 0) return [];
  const batch = queue.splice(0, n);
  writeQueue(queue);
  return batch;
}

export function queueLength(): number {
  return readQueue().length;
}
