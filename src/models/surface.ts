import { z } from "zod";

// ---------------------------------------------------------------------------
// Watchlist — tracked tools for event-driven news monitoring
// ---------------------------------------------------------------------------

export const WatchlistEntrySchema = z.object({
  name: z.string(),
  github_repos: z.array(z.string()).optional().default([]),
  github_org: z.string().optional(),
  official_blog_rss: z.string().nullable().optional(),
  aliases: z.array(z.string()).default([]),
  category: z.enum(["coding_agent", "adjacent_infra"]),
});

export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>;

// ---------------------------------------------------------------------------
// Surfaces — topic areas for content discovery (original pipeline)
// ---------------------------------------------------------------------------

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
  news_search_brands: z.array(z.string()).optional().default([]),
  watchlist: z.array(WatchlistEntrySchema).optional().default([]),
  surfaces: z.array(SurfaceSchema),
  subreddits: z.array(SubredditSchema),
  competitors: z.array(CompetitorSchema),
});

export type Surface = z.infer<typeof SurfaceSchema>;
export type Subreddit = z.infer<typeof SubredditSchema>;
export type Competitor = z.infer<typeof CompetitorSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
export type { WatchlistEntry as WatchlistEntryType };
