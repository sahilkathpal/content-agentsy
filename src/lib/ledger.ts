import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface SeenEntry {
  url: string;
  first_seen: string;
  last_seen: string;
  score: number | undefined;
  num_comments: number | undefined;
  source: string;
  surface_ids: string[];
}

export type SeenLedger = Record<string, SeenEntry>;

export interface ResurfaceThresholds {
  scoreMultiplier: number;
  scoreAbsolute: number;
  commentsMultiplier: number;
  commentsAbsolute: number;
}

const DEFAULT_THRESHOLDS: ResurfaceThresholds = {
  scoreMultiplier: 2,
  scoreAbsolute: 10,
  commentsMultiplier: 1.5,
  commentsAbsolute: 5,
};

const LEDGER_PATH = resolve(import.meta.dirname, "../data/seen-urls.json");
const PRUNE_DAYS = 90;

/**
 * Normalize a URL for consistent deduplication.
 * Strips trailing slash, www., and normalizes protocol to https.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/**
 * Load the seen-URLs ledger from disk.
 * Returns {} if the file doesn't exist.
 * Prunes entries with last_seen older than 90 days.
 */
export function loadLedger(): SeenLedger {
  let ledger: SeenLedger = {};

  try {
    const raw = readFileSync(LEDGER_PATH, "utf-8");
    ledger = JSON.parse(raw);
  } catch {
    return {};
  }

  // Prune entries older than 90 days
  const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const pruned: SeenLedger = {};
  let prunedCount = 0;

  for (const [key, entry] of Object.entries(ledger)) {
    if (new Date(entry.last_seen).getTime() >= cutoff) {
      pruned[key] = entry;
    } else {
      prunedCount++;
    }
  }

  if (prunedCount > 0) {
    console.log(`  [ledger] pruned ${prunedCount} entries older than ${PRUNE_DAYS} days`);
  }

  return pruned;
}

/**
 * Save the ledger back to disk.
 */
export function saveLedger(ledger: SeenLedger): void {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`  [ledger] saved ${Object.keys(ledger).length} entries → ${LEDGER_PATH}`);
}

