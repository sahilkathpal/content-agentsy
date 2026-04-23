import { z } from "zod";

// ── Threshold breach ────────────────────────────────────────────────

export const ThresholdBreachSchema = z.object({
  metric: z.string(),
  value: z.number(),
  threshold: z.number(),
  direction: z.enum(["above", "below"]),
});

// ── Data freshness ──────────────────────────────────────────────────

export const DataFreshnessSchema = z.object({
  otterly_last_sync: z.string().nullable(),
  gsc_last_sync: z.string().nullable(),
});

// ── GEO-SEO Quadrant per article ────────────────────────────────────

export const GeoSeoQuadrantSchema = z.object({
  slug: z.string(),
  url: z.string(),
  citations_7d: z.number().int(),
  gsc_clicks_7d: z.number().int(),
  quadrant: z.enum(["star", "seo_only", "geo_only", "orphan"]),
});

// ── Outcome Layer (15 metrics) ──────────────────────────────────────

export const OutcomeLayerSchema = z.object({
  // Citation volume
  domain_citations_total_7d: z.number().int(),
  domain_citations_by_engine: z.record(z.string(), z.number().int()),
  brand_mentions_7d: z.number().int(),

  // North-star prompt
  north_star_prompt: z.string(),
  north_star_status: z.record(z.string(), z.boolean()), // engine → cited

  // Position
  median_citation_position: z.number().nullable(),
  avg_citation_position: z.number().nullable(),

  // Share of voice
  position_weighted_sov_by_engine: z.record(z.string(), z.number()),
  position_weighted_sov_total: z.number(),

  // Coverage
  prompts_where_cited: z.number().int(),
  prompts_tracked: z.number().int(),
  citation_coverage_pct: z.number(),

  // Competitor comparison
  top_competitors_by_citations: z.array(z.object({
    name: z.string(),
    citations_7d: z.number().int(),
  })),

  // Article-level
  articles_with_citations_7d: z.number().int(),
  articles_total: z.number().int(),
});

// ── SEO Layer (9 metrics) ───────────────────────────────────────────

export const SeoLayerSchema = z.object({
  site_impressions_7d: z.number().int(),
  site_clicks_7d: z.number().int(),
  site_ctr_7d: z.number(),

  pages_with_impressions_7d: z.number().int(),
  branded_queries_impressions_7d: z.number().int(),
  non_branded_queries_impressions_7d: z.number().int(),

  rising_queries: z.array(z.object({
    query: z.string(),
    impressions_7d: z.number().int(),
    impressions_28d_avg_weekly: z.number(),
    growth_ratio: z.number(),
  })),

  declining_queries: z.array(z.object({
    query: z.string(),
    impressions_7d: z.number().int(),
    impressions_28d_avg_weekly: z.number(),
    growth_ratio: z.number(),
  })),

  top_pages_by_clicks: z.array(z.object({
    url: z.string(),
    clicks: z.number().int(),
    impressions: z.number().int(),
  })),

  top_queries: z.array(z.object({
    query: z.string(),
    impressions_7d: z.number().int(),
    clicks_7d: z.number().int(),
    ctr: z.number(),
    position: z.number(),
    is_branded: z.boolean(),
  })).optional().default([]),
});

// ── Bridge Layer ────────────────────────────────────────────────────

export const BridgeLayerSchema = z.object({
  geo_seo_quadrant_per_article: z.array(GeoSeoQuadrantSchema),
});

// ── Metadata ────────────────────────────────────────────────────────

export const ScorecardMetadataSchema = z.object({
  articles_count: z.number().int(),
  prompts_tracked: z.number().int(),
  engines_tracked: z.array(z.string()),
  data_freshness: DataFreshnessSchema,
  thresholds_breached: z.array(ThresholdBreachSchema),
});

// ── Full Site Scorecard ─────────────────────────────────────────────

export const SiteScorecardSchema = z.object({
  scorecard_id: z.string(),
  scored_at: z.string(),
  domain: z.string(),

  outcome: OutcomeLayerSchema,
  seo: SeoLayerSchema,
  bridge: BridgeLayerSchema,

  metadata: ScorecardMetadataSchema,
});

export type ThresholdBreach = z.infer<typeof ThresholdBreachSchema>;
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;
export type GeoSeoQuadrant = z.infer<typeof GeoSeoQuadrantSchema>;
export type OutcomeLayer = z.infer<typeof OutcomeLayerSchema>;
export type SeoLayer = z.infer<typeof SeoLayerSchema>;
export type BridgeLayer = z.infer<typeof BridgeLayerSchema>;
export type ScorecardMetadata = z.infer<typeof ScorecardMetadataSchema>;
export type SiteScorecard = z.infer<typeof SiteScorecardSchema>;
