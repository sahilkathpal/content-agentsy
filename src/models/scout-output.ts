import { z } from "zod";

export const OpportunitySchema = z.object({
  opportunity_id: z.string(),
  angle: z.string(),
  friction: z.string(),
  outcome: z.string(),
  meets_minimum_evidence: z.boolean(),
  possible_formats: z.array(z.string()),
  possible_channels: z.array(z.string()),
  proof_assets: z.array(z.string()),
  evidence: z.object({
    pain_signals: z.array(z.string()),
    demand_signals: z.array(z.string()),
    freshness_signals: z.array(z.string()),
  }),
  confidence_score: z.number().min(1).max(5),
  signal_ids: z.array(z.string()),
  freshness_profile: z.object({
    new: z.number(),
    resurfaced: z.number(),
    recurring: z.number(),
  }).optional(),
});

export const ScoutOutputSchema = z.object({
  surface_id: z.string(),
  surface_label: z.string(),
  signals_count: z.number(),
  opportunities: z.array(OpportunitySchema),
  analyzed_at: z.string(),
});

export type Opportunity = z.infer<typeof OpportunitySchema>;
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
