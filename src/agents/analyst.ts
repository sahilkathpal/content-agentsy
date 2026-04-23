import { readFileSync, writeFileSync } from "node:fs";
import { AnalystOutputSchema, type AnalystOutput } from "../models/analyst-output.js";
import { SiteScorecardSchema, type SiteScorecard } from "../models/site-scorecard.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";

/**
 * Layer 6 — Analyst
 *
 * Reads the site-wide scorecard (25 metrics across Outcome/SEO/Bridge layers)
 * and produces actionable strategy updates + threshold breach analysis.
 */
export async function runAnalyst(
  scorecardsPath: string,
  outPath: string,
  runId: string,
  analysisWindow?: string
): Promise<AnalystOutput | null> {
  const raw = JSON.parse(readFileSync(scorecardsPath, "utf-8"));
  const scorecard: SiteScorecard = SiteScorecardSchema.parse(raw);

  const now = new Date().toISOString();
  const window = analysisWindow ?? scorecard.scored_at.slice(0, 10);

  console.log(`  [analyst] Analyzing site scorecard (${scorecard.scorecard_id})…`);

  const thresholdBreaches = scorecard.metadata.thresholds_breached.length > 0
    ? JSON.stringify(scorecard.metadata.thresholds_breached, null, 2)
    : "None";

  const prompt = loadPrompt("analyst", {
    run_id: runId,
    analysis_window: window,
    analyzed_at: now,
    scorecard_json: JSON.stringify(scorecard, null, 2),
    domain: scorecard.domain,
    articles_count: String(scorecard.metadata.articles_count),
    prompts_tracked: String(scorecard.metadata.prompts_tracked),
    engines_tracked: scorecard.metadata.engines_tracked.join(", "),
    threshold_breaches: thresholdBreaches,
  });

  const text = await callClaude(prompt);

  try {
    const parsed = JSON.parse(extractJson(text));
    const output = AnalystOutputSchema.parse(parsed);

    console.log(`  [analyst] Analysis complete:`);
    console.log(`    Strategy notes: ${output.strategy_notes.length}`);
    console.log(`    Threshold responses: ${output.threshold_responses.length}`);
    console.log(`    Registry updates: ${output.registry_updates.length}`);
    console.log(`    Packet heuristic updates: ${output.packet_heuristic_updates.length}`);
    console.log(`    Scout focus updates: ${output.scout_focus_updates.length}`);

    writeFileSync(outPath, JSON.stringify(output, null, 2));
    return output;
  } catch (err) {
    console.warn(`  [analyst] Failed to parse analyst response:`, err);
    console.warn(`  Raw response (first 500 chars): ${text.slice(0, 500)}`);
    writeFileSync(outPath, JSON.stringify(null, null, 2));
    return null;
  }
}
