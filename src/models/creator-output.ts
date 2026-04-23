import { z } from "zod";

export const CreatorOutputSchema = z.object({
  packet_id: z.string(),
  surface_id: z.string(),
  intent_mode: z.enum(["M0_RESOLVE", "M1_EVALUATE", "M2_EXECUTE"]),
  title: z.string(),
  slug: z.string(),
  meta_description: z.string(),
  canonical_markdown: z.string(),
  geo_targets: z.array(z.string()),
  proof_artifacts_used: z.array(z.string()),
  external_links_used: z.array(z.object({
    url: z.string().url(),
    title: z.string(),
    domain: z.string(),
  })).optional(),
  internal_links_used: z.array(z.object({
    url: z.string().url(),
    title: z.string(),
  })).optional(),
  custom_excerpt: z.string().optional(),
  word_count: z.number(),
  created_at: z.string(),
});

export type CreatorOutput = z.infer<typeof CreatorOutputSchema>;
