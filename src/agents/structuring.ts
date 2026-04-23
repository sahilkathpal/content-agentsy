import { readFileSync, writeFileSync } from "node:fs";
import { SignalSchema, type Signal } from "../models/signal.js";
import type { Surface } from "../models/surface.js";
import type { RawBuckets } from "./sourcing.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { z } from "zod";
import { type SeenLedger, classifySignal, updateLedger } from "../ledger.js";

/**
 * Read raw buckets from disk, call Claude to structure into typed Signals,
 * apply freshness tagging from ledger, write signals to disk and return them.
 */
export async function runStructuring(
  surface: Surface,
  rawPath: string,
  outPath: string,
  ledger?: SeenLedger
): Promise<Signal[]> {
  const rawBuckets: RawBuckets = JSON.parse(readFileSync(rawPath, "utf-8"));

  const totalRaw =
    rawBuckets.community_pain.length +
    rawBuckets.official_change.length +
    rawBuckets.demand.length +
    rawBuckets.market_framing.length;

  if (totalRaw === 0) {
    console.log(`  [structuring] ${surface.id}: no raw results, skipping`);
    writeFileSync(outPath, "[]");
    return [];
  }

  console.log(`  [structuring] ${surface.id}: ${totalRaw} raw results → Claude…`);

  const prompt = loadPrompt("structuring", {
    surface_id: surface.id,
    surface_label: surface.label,
    search_terms: surface.search_terms.join(", "),
    collected_at: new Date().toISOString(),
    community_pain_count: String(rawBuckets.community_pain.length),
    community_pain_json: JSON.stringify(rawBuckets.community_pain.slice(0, 30), null, 2),
    official_change_count: String(rawBuckets.official_change.length),
    official_change_json: JSON.stringify(rawBuckets.official_change.slice(0, 20), null, 2),
    demand_count: String(rawBuckets.demand.length),
    demand_json: JSON.stringify(rawBuckets.demand.slice(0, 20), null, 2),
    market_framing_count: String(rawBuckets.market_framing.length),
    market_framing_json: JSON.stringify(rawBuckets.market_framing.slice(0, 20), null, 2),
  });

  const text = await callClaude(prompt);

  try {
    const parsed = JSON.parse(extractJson(text));
    const signals = z.array(SignalSchema).parse(parsed);

    // Post-process: apply freshness tagging from ledger
    if (ledger) {
      for (const signal of signals) {
        signal.freshness = classifySignal(signal, ledger);
      }
      updateLedger(ledger, signals, surface.id);

      const counts = { new: 0, resurfaced: 0, recurring: 0 };
      for (const s of signals) counts[s.freshness]++;
      console.log(`  [structuring] ${surface.id}: freshness — ${counts.new} new, ${counts.resurfaced} resurfaced, ${counts.recurring} recurring`);
    }

    console.log(`  [structuring] ${surface.id}: ${signals.length} structured signals → ${outPath}`);
    writeFileSync(outPath, JSON.stringify(signals, null, 2));
    return signals;
  } catch (err) {
    console.warn(`  [structuring] ${surface.id}: failed to parse Claude response:`, err);
    console.warn(`  Raw response (first 500 chars): ${text.slice(0, 500)}`);
    writeFileSync(outPath, "[]");
    return [];
  }
}
