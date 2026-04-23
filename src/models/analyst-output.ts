import { z } from "zod";

// ── Threshold response ────────────────────────────────────────────────

export const ThresholdResponseSchema = z.object({
  metric: z.string(),
  value: z.number(),
  threshold: z.number(),
  direction: z.enum(["above", "below"]),
  explanation: z.string(),
  recommended_action: z.string(),
});

// ── Engine concentration risk ─────────────────────────────────────────

export const EngineConcentrationSchema = z.object({
  engine: z.string(),
  citation_share_pct: z.number(),
  risk_level: z.enum(["low", "medium", "high"]),
  note: z.string(),
});

// ── Quadrant recommendation ───────────────────────────────────────────

export const QuadrantRecommendationSchema = z.object({
  slug: z.string(),
  quadrant: z.enum(["star", "seo_only", "geo_only", "orphan"]),
  recommendation: z.string(),
});

// ── Analyst cross-cutting queries ─────────────────────────────────────

export const ModePerformanceSchema = z.object({
  mode: z.enum(["M0_RESOLVE", "M1_EVALUATE", "M2_EXECUTE"]),
  avg_citations: z.number(),
  avg_sov: z.number(),
  sample_size: z.number().int(),
  note: z.string(),
});

export const FormatPerformanceSchema = z.object({
  format: z.string(),
  avg_citations: z.number(),
  avg_clicks: z.number(),
  sample_size: z.number().int(),
  note: z.string(),
});

// ── Registry update actions ───────────────────────────────────────────

export const RegistryUpdateSchema = z.object({
  surface_id: z.string(),
  action: z.enum(["promote", "demote", "drop"]),
  reason: z.string(),
});

export const PacketHeuristicUpdateSchema = z.object({
  format: z.string(),
  channel: z.string(),
  adjustment: z.enum(["favor", "neutral", "disfavor"]),
  reason: z.string(),
});

export const ScoutFocusSchema = z.object({
  surface_id: z.string(),
  direction: z.string(),
});

// ── Full Analyst output ───────────────────────────────────────────────

export const AnalystOutputSchema = z.object({
  run_id: z.string(),
  analysis_window: z.string(),
  analyzed_at: z.string().datetime(),
  domain: z.string(),

  // Threshold analysis
  threshold_responses: z.array(ThresholdResponseSchema),

  // Cross-cutting metrics
  engine_concentration: z.array(EngineConcentrationSchema),
  mode_performance: z.array(ModePerformanceSchema),
  format_performance: z.array(FormatPerformanceSchema),
  quadrant_recommendations: z.array(QuadrantRecommendationSchema),

  // Outputs that feed back into the factory
  strategy_notes: z.array(z.string()),
  registry_updates: z.array(RegistryUpdateSchema),
  packet_heuristic_updates: z.array(PacketHeuristicUpdateSchema),
  scout_focus_updates: z.array(ScoutFocusSchema),
});

export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;
