import { z } from "zod";

export const ScoresSchema = z.object({
  demand: z.number().min(1).max(5),
  proximity: z.number().min(1).max(5),
  proof: z.number().min(1).max(5),
  freshness: z.number().min(1).max(5),
  defensibility: z.number().min(1).max(5),
});

export const DistributionPacketSchema = z.object({
  packet_id: z.string(),
  opportunity_id: z.string(),
  surface_id: z.string(),

  // Content object equation
  surface_label: z.string(),
  friction: z.string(),
  outcome: z.string(),
  angle: z.string(),

  // Strategist decisions
  intent_mode: z.enum(["M0_RESOLVE", "M1_EVALUATE", "M2_EXECUTE"]),
  grass_role: z.enum(["light", "evaluate", "integrate", "execute"]),

  // Chosen format + channel + voice
  format: z.string(),
  primary_channel: z.string(),
  voice_type: z.string(),

  // Distribution plan
  canonical_asset: z.string(),
  syndication_targets: z.array(z.string()),
  proof_artifacts: z.array(z.string()),
  native_units: z.array(z.string()),
  participation_targets: z.array(z.string()),

  // Scoring
  scores: ScoresSchema,
  composite_score: z.number(),

  // Traceability
  signal_ids: z.array(z.string()),
  proof_assets: z.array(z.string()),
  reasoning: z.string(),
});

export const DroppedOpportunitySchema = z.object({
  opportunity_id: z.string(),
  surface_id: z.string(),
  angle: z.string(),
  reason: z.string(),
});

export const StrategistOutputSchema = z.object({
  run_id: z.string(),
  ranked_packets: z.array(DistributionPacketSchema),
  dropped: z.array(DroppedOpportunitySchema),
  strategy_notes: z.array(z.string()),
  analyzed_at: z.string(),
});

export type Scores = z.infer<typeof ScoresSchema>;
export type DistributionPacket = z.infer<typeof DistributionPacketSchema>;
export type DroppedOpportunity = z.infer<typeof DroppedOpportunitySchema>;
export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;
