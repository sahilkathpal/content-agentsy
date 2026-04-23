import { readFileSync, writeFileSync } from "node:fs";
import { ScoutOutputSchema, type ScoutOutput } from "../models/scout-output.js";
import { SignalSchema, type Signal } from "../models/signal.js";
import type { Surface } from "../models/surface.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { z } from "zod";

/**
 * Read structured signals from disk, call Claude to identify
 * multiple content opportunities, write output to disk and return it.
 */
export async function runAnalysis(
  surface: Surface,
  signalsPath: string,
  outPath: string
): Promise<ScoutOutput | null> {
  const signals: Signal[] = z.array(SignalSchema).parse(
    JSON.parse(readFileSync(signalsPath, "utf-8"))
  );

  if (signals.length === 0) {
    console.log(`  [analysis] ${surface.id}: no signals, skipping`);
    return null;
  }

  console.log(`  [analysis] ${surface.id}: analyzing ${signals.length} signals…`);

  const now = new Date().toISOString();

  const prompt = loadPrompt("analysis", {
    surface_id: surface.id,
    surface_label: surface.label,
    tier: String(surface.tier),
    type: surface.type,
    signals_count: String(signals.length),
    signals_json: JSON.stringify(signals, null, 2),
    analyzed_at: now,
  });

  const text = await callClaude(prompt, "claude-sonnet-4-6");

  try {
    const parsed = JSON.parse(extractJson(text));
    const output = ScoutOutputSchema.parse(parsed);

    // Enrich each opportunity with a deterministic freshness profile
    const signalMap = new Map(signals.map((s) => [s.id, s]));
    for (const opp of output.opportunities) {
      const profile = { new: 0, resurfaced: 0, recurring: 0 };
      for (const sid of opp.signal_ids) {
        const sig = signalMap.get(sid);
        if (sig) profile[sig.freshness]++;
      }
      opp.freshness_profile = profile;
    }

    const withEvidence = output.opportunities.filter((o) => o.meets_minimum_evidence).length;
    console.log(
      `  [analysis] ${surface.id}: ${output.opportunities.length} opportunities (${withEvidence} with evidence) → ${outPath}`
    );
    writeFileSync(outPath, JSON.stringify(output, null, 2));
    return output;
  } catch (err) {
    console.warn(`  [analysis] ${surface.id}: failed to parse Claude response:`, err);
    console.warn(`  Raw response (first 500 chars): ${text.slice(0, 500)}`);
    const fallback: ScoutOutput = {
      surface_id: surface.id,
      surface_label: surface.label,
      signals_count: signals.length,
      opportunities: [],
      analyzed_at: now,
    };
    writeFileSync(outPath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}
