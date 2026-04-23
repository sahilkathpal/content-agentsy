import { getSiteMetrics, getQueryMetrics, getPageList } from "../sources/gsc.js";
import { getDb } from "../db/helpers.js";
import "dotenv/config";

/**
 * Sync Google Search Console data into SQLite.
 * Usage: npx tsx src/sync/sync-gsc.ts
 */
async function main() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Site-level metrics
  console.log("[sync-gsc] Fetching site metrics (7d)...");
  const site = await getSiteMetrics("7d");
  console.log(`[sync-gsc] Site: ${site.impressions} impressions, ${site.clicks} clicks, ${site.ctr}% CTR`);

  db.prepare(`
    INSERT OR REPLACE INTO gsc_site_metrics (date, impressions, clicks, ctr)
    VALUES (?, ?, ?, ?)
  `).run(today, site.impressions, site.clicks, site.ctr);

  // 2. Query metrics — 7d and 28d
  console.log("[sync-gsc] Fetching query metrics (7d)...");
  const queries7d = await getQueryMetrics("7d", 500);
  console.log(`[sync-gsc] Got ${queries7d.length} queries (7d)`);

  console.log("[sync-gsc] Fetching query metrics (28d)...");
  const queries28d = await getQueryMetrics("28d", 500);
  console.log(`[sync-gsc] Got ${queries28d.length} queries (28d)`);

  // Build a map of 28d data keyed by query
  const map28d = new Map(queries28d.map((q) => [q.query, q]));

  // Upsert 7d data first
  const upsertQuery = db.prepare(`
    INSERT INTO gsc_query_metrics
      (snapshot_date, query, impressions_7d, clicks_7d, impressions_28d, clicks_28d, ctr, position, is_branded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date, query) DO UPDATE SET
      impressions_7d = excluded.impressions_7d,
      clicks_7d = excluded.clicks_7d,
      impressions_28d = excluded.impressions_28d,
      clicks_28d = excluded.clicks_28d,
      ctr = excluded.ctr,
      position = excluded.position,
      is_branded = excluded.is_branded
  `);

  const allQueries = new Set([...queries7d.map((q) => q.query), ...queries28d.map((q) => q.query)]);

  const insertMany = db.transaction(() => {
    for (const queryText of allQueries) {
      const d7 = queries7d.find((q) => q.query === queryText);
      const d28 = map28d.get(queryText);
      const isBranded = queryText.includes("grass") || queryText.includes("codeongrass") ? 1 : 0;

      upsertQuery.run(
        today,
        queryText,
        d7?.impressions ?? 0,
        d7?.clicks ?? 0,
        d28?.impressions ?? 0,
        d28?.clicks ?? 0,
        d7?.ctr ?? d28?.ctr ?? 0,
        d7?.position ?? d28?.position ?? 0,
        isBranded,
      );
    }
  });
  insertMany();
  console.log(`[sync-gsc] Upserted ${allQueries.size} query rows`);

  // 3. Page-level metrics
  console.log("[sync-gsc] Fetching page list (7d)...");
  const pages = await getPageList("7d");
  console.log(`[sync-gsc] Got ${pages.length} pages`);

  const upsertPage = db.prepare(`
    INSERT OR REPLACE INTO gsc_page_metrics (snapshot_date, url, impressions, clicks, ctr)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertPages = db.transaction(() => {
    for (const page of pages) {
      const ctr = page.impressions > 0 ? Math.round((page.clicks / page.impressions) * 10000) / 100 : 0;
      upsertPage.run(today, page.url, page.impressions, page.clicks, ctr);
    }
  });
  insertPages();
  console.log(`[sync-gsc] Upserted ${pages.length} page rows`);

  // Summary
  const siteTotal = db.prepare("SELECT count(*) as n FROM gsc_site_metrics").get() as { n: number };
  const queryTotal = db.prepare("SELECT count(*) as n FROM gsc_query_metrics WHERE snapshot_date = ?").get(today) as { n: number };
  const pageTotal = db.prepare("SELECT count(*) as n FROM gsc_page_metrics WHERE snapshot_date = ?").get(today) as { n: number };
  console.log(`[sync-gsc] DB: ${siteTotal.n} site snapshots, ${queryTotal.n} queries today, ${pageTotal.n} pages today`);
}

main().catch((err) => {
  console.error("[sync-gsc] Fatal:", err);
  process.exit(1);
});
