import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────

export const IntentMode = z.enum(["M0_RESOLVE", "M1_EVALUATE", "M2_EXECUTE"]);

export const VoiceType = z.enum([
  "brand_canonical",
  "engineer_voice",
  "founder_operator_voice",
  "contributor_voice",
  "community_voice",
]);

export const AssetType = z.enum([
  "canonical",
  "syndication",
  "proof",
  "conversation",
  "participation",
]);

const ScoringWindow = z.enum(["7d", "14d", "30d", "90d"]);

// ── SEO Metrics (from Google Search Console) ───────────────────────────

export const SeoMetricsSchema = z.object({
  organic_impressions: z.number().int(),
  organic_clicks: z.number().int(),
  organic_ctr: z.number(), // percentage
  ranking_positions: z.record(z.string(), z.number()), // keyword → position
});

// ── GEO / Citation Metrics (from Otterly) ─────────────────────────────

export const GeoMetricsSchema = z.object({
  llm_citation_count: z.number().int(),
  ai_search_inclusion: z.record(z.string(), z.boolean()), // engine → included
  share_of_voice_score: z.number(),
  extractability_score: z.number(),
  target_prompts_tracked: z.array(z.string()),
});

// ── Scorecard ──────────────────────────────────────────────────────────

export const ScorecardSchema = z.object({
  // Identity fields (tags for cross-cutting analysis)
  scorecard_id: z.string(),
  packet_id: z.string(),
  asset_id: z.string(),
  surface_id: z.string(),
  mode: IntentMode,
  format: z.string(), // e.g. troubleshooting, comparison, guide
  voice_type: VoiceType,
  channel: z.string(), // blog, DEV, X, LinkedIn, Reddit, etc.
  asset_type: AssetType,

  // Metric blocks
  seo: SeoMetricsSchema,
  geo: GeoMetricsSchema,

  // Metadata
  published_at: z.string().datetime(),
  scored_at: z.string().datetime(),
  scoring_window: ScoringWindow,
});

export type SeoMetrics = z.infer<typeof SeoMetricsSchema>;
export type GeoMetrics = z.infer<typeof GeoMetricsSchema>;
export type Scorecard = z.infer<typeof ScorecardSchema>;
