import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Signal } from "./models/signal.js";
import type { SignalFreshnessType } from "./models/signal.js";

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

/**
 * Classify a signal's freshness based on ledger history.
 * - "new": URL not seen before
 * - "resurfaced": seen before but score/comments grew significantly
 * - "recurring": seen before, no significant change
 */
export function classifySignal(
  signal: Signal,
  ledger: SeenLedger,
  thresholds: ResurfaceThresholds = DEFAULT_THRESHOLDS
): SignalFreshnessType {
  if (!signal.url) return "new";

  const key = normalizeUrl(signal.url);
  const entry = ledger[key];
  if (!entry) return "new";

  // Check if score or comments have grown enough to count as "resurfaced"
  if (signal.score != null && entry.score != null && entry.score > 0) {
    if (
      signal.score >= entry.score * thresholds.scoreMultiplier ||
      signal.score >= entry.score + thresholds.scoreAbsolute
    ) {
      return "resurfaced";
    }
  }

  if (signal.num_comments != null && entry.num_comments != null && entry.num_comments > 0) {
    if (
      signal.num_comments >= entry.num_comments * thresholds.commentsMultiplier ||
      signal.num_comments >= entry.num_comments + thresholds.commentsAbsolute
    ) {
      return "resurfaced";
    }
  }

  return "recurring";
}

/**
 * Update the ledger with signals from a structuring run.
 */
export function updateLedger(
  ledger: SeenLedger,
  signals: Signal[],
  surfaceId: string
): void {
  const now = new Date().toISOString();

  for (const signal of signals) {
    if (!signal.url) continue;

    const key = normalizeUrl(signal.url);
    const existing = ledger[key];

    if (existing) {
      existing.last_seen = now;
      if (signal.score != null) existing.score = signal.score;
      if (signal.num_comments != null) existing.num_comments = signal.num_comments;
      if (!existing.surface_ids.includes(surfaceId)) {
        existing.surface_ids.push(surfaceId);
      }
    } else {
      ledger[key] = {
        url: signal.url,
        first_seen: now,
        last_seen: now,
        score: signal.score,
        num_comments: signal.num_comments,
        source: signal.source,
        surface_ids: [surfaceId],
      };
    }
  }
}
