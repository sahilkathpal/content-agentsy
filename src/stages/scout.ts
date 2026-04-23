import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRegistry, selectSurfaces } from "../registry/registry.js";
import { runSourcing } from "../agents/sourcing.js";
import { runStructuring } from "../agents/structuring.js";
import { runAnalysis } from "../agents/analysis.js";
import { loadLedger, saveLedger } from "../ledger.js";
import type { ScoutOutput } from "../models/scout-output.js";
import type { PipelineContext } from "../pipeline.js";

/**
 * Concurrency-limited parallel execution.
 */
async function withConcurrency<T>(
  items: T[],
  maxConcurrent: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let running = 0;
  let idx = 0;

  return new Promise((resolveAll, rejectAll) => {
    let completed = 0;
    const total = items.length;

    if (total === 0) { resolveAll(); return; }

    function next() {
      while (running < maxConcurrent && idx < total) {
        const item = items[idx++];
        running++;
        fn(item)
          .then(() => {
            running--;
            completed++;
            if (completed === total) resolveAll();
            else next();
          })
          .catch(rejectAll);
      }
    }

    next();
  });
}

/**
 * Scout stage: sourcing -> structuring -> analysis for each surface.
 * Writes combined scout-output.json to the run directory.
 */
export async function runScout(ctx: PipelineContext): Promise<void> {
  const registry = loadRegistry();
  const surfaces = selectSurfaces(registry, ctx.opts);

  // Load seen-URLs ledger
  const ledger = loadLedger();
  const ledgerSizeBefore = Object.keys(ledger).length;
  console.log(`Ledger: ${ledgerSizeBefore} previously seen URLs\n`);

  const allOutputs: ScoutOutput[] = [];

  await withConcurrency(surfaces, ctx.opts.maxConcurrent, async (surface) => {
    const surfaceDir = resolve(ctx.runDir, surface.id);
    mkdirSync(surfaceDir, { recursive: true });

    const rawPath = resolve(surfaceDir, "raw-buckets.json");
    const signalsPath = resolve(surfaceDir, "signals.json");
    const scoutPath = resolve(surfaceDir, "scout-output.json");

    console.log(`\n--- ${surface.id} (tier ${surface.tier}) ---`);

    // Sourcing -> Structuring -> Analysis
    await runSourcing(surface, registry, rawPath);
    await runStructuring(surface, rawPath, signalsPath, ledger);
    const output = await runAnalysis(surface, signalsPath, scoutPath);
    if (output) allOutputs.push(output);
  });

  // Save updated ledger
  const ledgerSizeAfter = Object.keys(ledger).length;
  console.log(`\nLedger: ${ledgerSizeBefore} -> ${ledgerSizeAfter} URLs (+${ledgerSizeAfter - ledgerSizeBefore} new)`);
  saveLedger(ledger);

  // Sort surfaces by best opportunity confidence
  allOutputs.sort((a, b) => {
    const bestA = Math.max(0, ...a.opportunities.map((o) => o.confidence_score));
    const bestB = Math.max(0, ...b.opportunities.map((o) => o.confidence_score));
    return bestB - bestA;
  });

  const scoutOutputPath = resolve(ctx.runDir, "scout-output.json");
  writeFileSync(scoutOutputPath, JSON.stringify(allOutputs, null, 2));

  // Summary
  const totalOpps = allOutputs.reduce((n, o) => n + o.opportunities.length, 0);
  const withEvidence = allOutputs.reduce(
    (n, o) => n + o.opportunities.filter((op) => op.meets_minimum_evidence).length, 0,
  );
  console.log(`\nScout: ${totalOpps} opportunities across ${allOutputs.length} surfaces (${withEvidence} with evidence)`);

  for (const out of allOutputs) {
    console.log(`\n${out.surface_id} (${out.signals_count} signals, ${out.opportunities.length} opportunities)`);
    for (const opp of out.opportunities) {
      const ev = opp.meets_minimum_evidence ? "YES" : "no";
      console.log(`  [${opp.confidence_score}/5 ${ev.padEnd(3)}] ${opp.opportunity_id}: ${opp.angle}`);
    }
  }
}
