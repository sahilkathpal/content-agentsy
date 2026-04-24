import { parsePromptsCsv, parseCitationsCsv } from "../sources/otterly.js";
import { getDb, upsertPrompt, upsertCitation, slugFromUrl, upsertCompetitor } from "../db/helpers.js";
import "dotenv/config";

const OTTERLY_ENGINES = ["chatgpt", "perplexity", "google_aio", "copilot"];

/**
 * Sync Otterly CSV exports into SQLite.
 * Paths are read from env vars: OTTERLY_PROMPTS_CSV and OTTERLY_CITATIONS_CSV
 */
async function main() {
  const promptsCsvPath = process.env.OTTERLY_PROMPTS_CSV;
  const citationsCsvPath = process.env.OTTERLY_CITATIONS_CSV;

  if (!promptsCsvPath && !citationsCsvPath) {
    console.error("Set OTTERLY_PROMPTS_CSV and/or OTTERLY_CITATIONS_CSV in your .env");
    process.exit(1);
  }

  const db = getDb();

  // Sync prompts
  if (promptsCsvPath) {
    console.log(`[sync-otterly] Parsing prompts CSV: ${promptsCsvPath}`);
    const prompts = parsePromptsCsv(promptsCsvPath);
    console.log(`[sync-otterly] Found ${prompts.length} prompt rows`);

    let promptCount = 0;
    for (const row of prompts) {
      upsertPrompt(row.prompt, OTTERLY_ENGINES, row.intent_volume_monthly, row.three_month_growth);
      promptCount++;

      // Upsert competitors from this row
      for (const name of Object.keys(row.competitors)) {
        upsertCompetitor(name, [], "otterly");
      }
    }
    console.log(`[sync-otterly] Upserted ${promptCount} prompts`);
  }

  // Sync citations
  if (citationsCsvPath) {
    console.log(`[sync-otterly] Parsing citations CSV: ${citationsCsvPath}`);
    const citations = parseCitationsCsv(citationsCsvPath);
    console.log(`[sync-otterly] Found ${citations.length} citation rows`);

    let citationCount = 0;
    for (const row of citations) {
      // Look up prompt_id
      const promptRow = db.prepare(
        "SELECT prompt_id FROM prompts WHERE prompt_text = ?"
      ).get(row.prompt) as { prompt_id: number } | undefined;

      if (!promptRow) {
        console.warn(`[sync-otterly] Skipping citation for unknown prompt: "${row.prompt}"`);
        continue;
      }

      const articleSlug = slugFromUrl(row.url);
      upsertCitation({
        prompt_id: promptRow.prompt_id,
        engine: row.service,
        url: row.url,
        position: row.position,
        date: row.date,
        domain: row.domain,
        article_slug: articleSlug,
        brand_mentioned: row.my_brand_mentioned ? 1 : 0,
        competitors_mentioned: row.competitors_mentioned,
        source: "otterly",
      });
      citationCount++;
    }
    console.log(`[sync-otterly] Upserted ${citationCount} citations`);
  }

  // Summary
  const promptTotal = db.prepare("SELECT count(*) as n FROM prompts").get() as { n: number };
  const citationTotal = db.prepare("SELECT count(*) as n FROM citations").get() as { n: number };
  console.log(`[sync-otterly] DB totals: ${promptTotal.n} prompts, ${citationTotal.n} citations`);
}

main().catch((err) => {
  console.error("[sync-otterly] Fatal:", err);
  process.exit(1);
});
