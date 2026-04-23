import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../db/helpers.js";
import type {
  SiteScorecard,
  ThresholdBreach,
  GeoSeoQuadrant,
} from "../models/site-scorecard.js";
import "dotenv/config";

const DOMAIN = process.env.SITE_DOMAIN ?? "codeongrass.com";
const NORTH_STAR_PROMPT = process.env.NORTH_STAR_PROMPT ?? "";

// Configurable thresholds (metric → { min?, max? })
const THRESHOLDS: Record<string, { min?: number; max?: number }> = {
  domain_citations_total_7d: { min: 1 },
  citation_coverage_pct: { min: 10 },
  site_clicks_7d: { min: 1 },
};

/**
 * Site-wide scorecard generator — all data comes from SQLite.
 * No external API calls. Computes 25 metrics across Outcome, SEO, and Bridge layers.
 */
export async function runScorecard(): Promise<SiteScorecard> {
  const db = getDb();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const scorecardId = `site_${today}`;

  // ── Outcome Layer ───────────────────────────────────────────────

  // Domain citations (7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since7d = sevenDaysAgo.toISOString().slice(0, 10);

  const domainCitationsTotal = (db.prepare(`
    SELECT COUNT(*) as n FROM citations
    WHERE domain = ? AND date >= ?
  `).get(DOMAIN, since7d) as { n: number }).n;

  // Citations by engine
  const citationsByEngine = db.prepare(`
    SELECT engine, COUNT(*) as n FROM citations
    WHERE domain = ? AND date >= ?
    GROUP BY engine
  `).all(DOMAIN, since7d) as Array<{ engine: string; n: number }>;

  const domainCitationsByEngine: Record<string, number> = {};
  for (const row of citationsByEngine) {
    domainCitationsByEngine[row.engine] = row.n;
  }

  // Brand mentions
  const brandMentions = (db.prepare(`
    SELECT COUNT(*) as n FROM citations
    WHERE domain = ? AND date >= ? AND brand_mentioned = 1
  `).get(DOMAIN, since7d) as { n: number }).n;

  // North-star prompt status
  const northStarStatus: Record<string, boolean> = {};
  if (NORTH_STAR_PROMPT) {
    const promptRow = db.prepare(
      "SELECT prompt_id, engines_tracked FROM prompts WHERE prompt_text = ?"
    ).get(NORTH_STAR_PROMPT) as { prompt_id: number; engines_tracked: string } | undefined;

    if (promptRow) {
      const engines = JSON.parse(promptRow.engines_tracked) as string[];
      for (const engine of engines) {
        const cited = db.prepare(`
          SELECT COUNT(*) as n FROM citations
          WHERE prompt_id = ? AND engine = ? AND domain = ? AND date >= ?
        `).get(promptRow.prompt_id, engine, DOMAIN, since7d) as { n: number };
        northStarStatus[engine] = cited.n > 0;
      }
    }
  }

  // Citation positions
  const positions = db.prepare(`
    SELECT position FROM citations
    WHERE domain = ? AND date >= ?
    ORDER BY position
  `).all(DOMAIN, since7d) as Array<{ position: number }>;

  let medianPosition: number | null = null;
  let avgPosition: number | null = null;
  if (positions.length > 0) {
    const mid = Math.floor(positions.length / 2);
    medianPosition = positions.length % 2 === 0
      ? (positions[mid - 1].position + positions[mid].position) / 2
      : positions[mid].position;
    avgPosition = Math.round(
      (positions.reduce((s, p) => s + p.position, 0) / positions.length) * 100
    ) / 100;
  }

  // Position-weighted share of voice by engine (Otterly engines only)
  const otterlyEngines = ["chatgpt", "perplexity", "google_aio", "copilot"];
  const sovByEngine: Record<string, number> = {};
  let sovTotal = 0;

  for (const engine of otterlyEngines) {
    // Our domain's weighted score
    const ourScore = db.prepare(`
      SELECT SUM(1.0 / (LOG(position + 1) / LOG(2) + 1)) as score FROM citations
      WHERE engine = ? AND domain = ? AND date >= ?
    `).get(engine, DOMAIN, since7d) as { score: number | null };

    // All domains' weighted score
    const totalScore = db.prepare(`
      SELECT SUM(1.0 / (LOG(position + 1) / LOG(2) + 1)) as score FROM citations
      WHERE engine = ? AND date >= ?
    `).get(engine, since7d) as { score: number | null };

    const sov = (totalScore.score && ourScore.score)
      ? Math.round((ourScore.score / totalScore.score) * 10000) / 100
      : 0;
    sovByEngine[engine] = sov;
    sovTotal += sov;
  }
  sovTotal = otterlyEngines.length > 0 ? Math.round((sovTotal / otterlyEngines.length) * 100) / 100 : 0;

  // Citation coverage
  const promptsCited = (db.prepare(`
    SELECT COUNT(DISTINCT prompt_id) as n FROM citations
    WHERE domain = ? AND date >= ?
  `).get(DOMAIN, since7d) as { n: number }).n;

  const promptsTracked = (db.prepare(
    "SELECT COUNT(*) as n FROM prompts"
  ).get() as { n: number }).n;

  const citationCoveragePct = promptsTracked > 0
    ? Math.round((promptsCited / promptsTracked) * 10000) / 100
    : 0;

  // Top competitors by citations
  const topCompetitors = db.prepare(`
    SELECT c.name, COUNT(*) as citations_7d
    FROM competitors c
    JOIN citations cit ON cit.date >= ? AND instr(cit.competitors_mentioned, c.name) > 0
    GROUP BY c.name
    ORDER BY citations_7d DESC
  `).all(since7d) as Array<{ name: string; citations_7d: number }>;

  // Articles with citations
  const articlesWithCitations = (db.prepare(`
    SELECT COUNT(DISTINCT article_slug) as n FROM citations
    WHERE article_slug IS NOT NULL AND date >= ?
  `).get(since7d) as { n: number }).n;

  const articlesTotal = (db.prepare(
    "SELECT COUNT(*) as n FROM articles"
  ).get() as { n: number }).n;

  // ── SEO Layer ───────────────────────────────────────────────────

  const siteMetrics = db.prepare(`
    SELECT impressions, clicks, ctr FROM gsc_site_metrics
    ORDER BY date DESC LIMIT 1
  `).get() as { impressions: number; clicks: number; ctr: number } | undefined;

  const pagesWithImpressions = (db.prepare(`
    SELECT COUNT(*) as n FROM gsc_page_metrics
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM gsc_page_metrics)
      AND impressions > 0
  `).get() as { n: number }).n;

  const latestSnapshot = (db.prepare(
    "SELECT MAX(snapshot_date) as d FROM gsc_query_metrics"
  ).get() as { d: string | null }).d ?? today;

  const brandedImpressions = (db.prepare(`
    SELECT COALESCE(SUM(impressions_7d), 0) as n FROM gsc_query_metrics
    WHERE snapshot_date = ? AND is_branded = 1
  `).get(latestSnapshot) as { n: number }).n;

  const nonBrandedImpressions = (db.prepare(`
    SELECT COALESCE(SUM(impressions_7d), 0) as n FROM gsc_query_metrics
    WHERE snapshot_date = ? AND is_branded = 0
  `).get(latestSnapshot) as { n: number }).n;

  // Rising queries (7d impressions vs 28d weekly avg, ratio >= 1.5)
  const allQueryRows = db.prepare(`
    SELECT query, impressions_7d, impressions_28d FROM gsc_query_metrics
    WHERE snapshot_date = ? AND impressions_7d > 0
  `).all(latestSnapshot) as Array<{ query: string; impressions_7d: number; impressions_28d: number }>;

  const risingQueries: Array<{ query: string; impressions_7d: number; impressions_28d_avg_weekly: number; growth_ratio: number }> = [];
  const decliningQueries: Array<{ query: string; impressions_7d: number; impressions_28d_avg_weekly: number; growth_ratio: number }> = [];

  for (const row of allQueryRows) {
    const weeklyAvg = row.impressions_28d / 4;
    if (weeklyAvg <= 0) continue;
    const ratio = Math.round((row.impressions_7d / weeklyAvg) * 100) / 100;

    if (ratio >= 1.5) {
      risingQueries.push({
        query: row.query,
        impressions_7d: row.impressions_7d,
        impressions_28d_avg_weekly: Math.round(weeklyAvg * 100) / 100,
        growth_ratio: ratio,
      });
    } else if (ratio <= 0.5) {
      decliningQueries.push({
        query: row.query,
        impressions_7d: row.impressions_7d,
        impressions_28d_avg_weekly: Math.round(weeklyAvg * 100) / 100,
        growth_ratio: ratio,
      });
    }
  }

  risingQueries.sort((a, b) => b.growth_ratio - a.growth_ratio);
  decliningQueries.sort((a, b) => a.growth_ratio - b.growth_ratio);

  // Top pages by clicks
  const topPages = db.prepare(`
    SELECT url, clicks, impressions FROM gsc_page_metrics
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM gsc_page_metrics)
    ORDER BY clicks DESC
    LIMIT 10
  `).all() as Array<{ url: string; clicks: number; impressions: number }>;

  // Top queries by impressions (7d)
  const topQueries = db.prepare(`
    SELECT query, impressions_7d, clicks_7d, ctr, position, is_branded
    FROM gsc_query_metrics
    WHERE snapshot_date = ?
    ORDER BY impressions_7d DESC
    LIMIT 15
  `).all(latestSnapshot) as Array<{ query: string; impressions_7d: number; clicks_7d: number; ctr: number; position: number; is_branded: number }>;

  // ── Bridge Layer ────────────────────────────────────────────────

  // GEO-SEO quadrant: join citations by slug with gsc_page_metrics
  const articles = db.prepare("SELECT slug, url FROM articles").all() as Array<{ slug: string; url: string }>;
  const quadrants: GeoSeoQuadrant[] = [];

  const CITATION_THRESHOLD = 1;
  const CLICKS_THRESHOLD = 1;

  for (const article of articles) {
    const citCount = (db.prepare(`
      SELECT COUNT(*) as n FROM citations
      WHERE article_slug = ? AND date >= ?
    `).get(article.slug, since7d) as { n: number }).n;

    const gscRow = db.prepare(`
      SELECT COALESCE(clicks, 0) as clicks FROM gsc_page_metrics
      WHERE url = ? AND snapshot_date = (SELECT MAX(snapshot_date) FROM gsc_page_metrics)
    `).get(article.url) as { clicks: number } | undefined;

    const clicks = gscRow?.clicks ?? 0;

    let quadrant: "star" | "seo_only" | "geo_only" | "orphan";
    if (citCount >= CITATION_THRESHOLD && clicks >= CLICKS_THRESHOLD) {
      quadrant = "star";
    } else if (clicks >= CLICKS_THRESHOLD) {
      quadrant = "seo_only";
    } else if (citCount >= CITATION_THRESHOLD) {
      quadrant = "geo_only";
    } else {
      quadrant = "orphan";
    }

    quadrants.push({
      slug: article.slug,
      url: article.url,
      citations_7d: citCount,
      gsc_clicks_7d: clicks,
      quadrant,
    });
  }

  // ── Metadata ────────────────────────────────────────────────────

  const allEngines = db.prepare(`
    SELECT DISTINCT engine FROM citations
  `).all() as Array<{ engine: string }>;

  // Data freshness: latest sync dates from the data itself
  const latestCitationDate = (db.prepare(
    "SELECT MAX(date) as d FROM citations WHERE source = 'otterly'"
  ).get() as { d: string | null }).d;
  const latestGscDate = (db.prepare(
    "SELECT MAX(date) as d FROM gsc_site_metrics"
  ).get() as { d: string | null }).d;

  // Threshold checks
  const thresholdsBreached: ThresholdBreach[] = [];
  const metricsToCheck: Record<string, number> = {
    domain_citations_total_7d: domainCitationsTotal,
    citation_coverage_pct: citationCoveragePct,
    site_clicks_7d: siteMetrics?.clicks ?? 0,
  };

  for (const [metric, thresholds] of Object.entries(THRESHOLDS)) {
    const value = metricsToCheck[metric] ?? 0;
    if (thresholds.min !== undefined && value < thresholds.min) {
      thresholdsBreached.push({ metric, value, threshold: thresholds.min, direction: "below" });
    }
    if (thresholds.max !== undefined && value > thresholds.max) {
      thresholdsBreached.push({ metric, value, threshold: thresholds.max, direction: "above" });
    }
  }

  // ── Assemble ────────────────────────────────────────────────────

  const scorecard: SiteScorecard = {
    scorecard_id: scorecardId,
    scored_at: now,
    domain: DOMAIN,

    outcome: {
      domain_citations_total_7d: domainCitationsTotal,
      domain_citations_by_engine: domainCitationsByEngine,
      brand_mentions_7d: brandMentions,
      north_star_prompt: NORTH_STAR_PROMPT,
      north_star_status: northStarStatus,
      median_citation_position: medianPosition,
      avg_citation_position: avgPosition,
      position_weighted_sov_by_engine: sovByEngine,
      position_weighted_sov_total: sovTotal,
      prompts_where_cited: promptsCited,
      prompts_tracked: promptsTracked,
      citation_coverage_pct: citationCoveragePct,
      top_competitors_by_citations: topCompetitors,
      articles_with_citations_7d: articlesWithCitations,
      articles_total: articlesTotal,
    },

    seo: {
      site_impressions_7d: siteMetrics?.impressions ?? 0,
      site_clicks_7d: siteMetrics?.clicks ?? 0,
      site_ctr_7d: siteMetrics?.ctr ?? 0,
      pages_with_impressions_7d: pagesWithImpressions,
      branded_queries_impressions_7d: brandedImpressions,
      non_branded_queries_impressions_7d: nonBrandedImpressions,
      rising_queries: risingQueries.slice(0, 20),
      declining_queries: decliningQueries.slice(0, 20),
      top_pages_by_clicks: topPages,
      top_queries: topQueries.map(r => ({
        query: r.query,
        impressions_7d: r.impressions_7d,
        clicks_7d: r.clicks_7d,
        ctr: r.ctr,
        position: r.position,
        is_branded: r.is_branded === 1,
      })),
    },

    bridge: {
      geo_seo_quadrant_per_article: quadrants,
    },

    metadata: {
      articles_count: articlesTotal,
      prompts_tracked: promptsTracked,
      engines_tracked: allEngines.map((e) => e.engine),
      data_freshness: {
        otterly_last_sync: latestCitationDate,
        gsc_last_sync: latestGscDate,
      },
      thresholds_breached: thresholdsBreached,
    },
  };

  // Write to data/scorecard.json (latest) and data/scorecards/ (history)
  const dataDir = resolve(import.meta.dirname, "../../data");
  const scorecardsDir = resolve(dataDir, "scorecards");

  if (!existsSync(scorecardsDir)) mkdirSync(scorecardsDir, { recursive: true });

  const latestPath = resolve(dataDir, "scorecard.json");
  const historyPath = resolve(scorecardsDir, `scorecard-${today}.json`);

  writeFileSync(latestPath, JSON.stringify(scorecard, null, 2));
  writeFileSync(historyPath, JSON.stringify(scorecard, null, 2));

  console.log(`[scorer] Scorecard generated → ${latestPath}`);
  console.log(`[scorer] History saved → ${historyPath}`);

  if (thresholdsBreached.length > 0) {
    console.log(`[scorer] Thresholds breached:`);
    for (const t of thresholdsBreached) {
      console.log(`  ${t.metric}: ${t.value} (threshold: ${t.direction} ${t.threshold})`);
    }
  }

  return scorecard;
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("scorer.ts")) {
  runScorecard().catch((err) => {
    console.error("[scorer] Fatal:", err);
    process.exit(1);
  });
}
