import { z } from "zod";

export const SignalBucket = z.enum([
  "official_change",
  "community_pain",
  "demand",
  "market_framing",
]);

export const SignalFreshness = z.enum(["new", "resurfaced", "recurring"]);

export const SignalSchema = z.object({
  id: z.string(),
  surface_id: z.string(),
  bucket: SignalBucket,
  title: z.string(),
  summary: z.string(),
  url: z.string().optional(),
  source: z.string(),
  raw_text: z.string().optional(),
  collected_at: z.string(),
  freshness: SignalFreshness.default("new"),
  score: z.number().optional(),
  num_comments: z.number().optional(),
});

export type Signal = z.infer<typeof SignalSchema>;
export type SignalBucketType = z.infer<typeof SignalBucket>;
export type SignalFreshnessType = z.infer<typeof SignalFreshness>;
