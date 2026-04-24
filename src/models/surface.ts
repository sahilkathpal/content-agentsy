import { z } from "zod";

export const SurfaceSchema = z.object({
  id: z.string(),
  label: z.string(),
  topic_tag: z.string().optional(),
  type: z.enum(["permanent", "rotating"]),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  search_terms: z.array(z.string()),
  official_urls: z.array(z.string()).optional().default([]),
});

export const SubredditSchema = z.object({
  name: z.string(),
  surface_ids: z.array(z.string()),
  monitor_new: z.boolean(),
});

export const CompetitorSchema = z.object({
  name: z.string(),
  surface_ids: z.array(z.string()),
  watched_urls: z.array(z.string()),
});

export const RegistrySchema = z.object({
  version: z.string(),
  last_updated: z.string(),
  notes: z.string().optional(),
  surfaces: z.array(SurfaceSchema),
  subreddits: z.array(SubredditSchema),
  competitors: z.array(CompetitorSchema),
});

export type Surface = z.infer<typeof SurfaceSchema>;
export type Subreddit = z.infer<typeof SubredditSchema>;
export type Competitor = z.infer<typeof CompetitorSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
