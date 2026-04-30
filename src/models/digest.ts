import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent result envelope — wraps every agent's output with timing + warnings
// ---------------------------------------------------------------------------

export interface AgentResult<T> {
  data: T;
  duration_ms: number;
  warnings: string[];
}

export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<AgentResult<T>> {
  const start = performance.now();
  const data = await fn();
  const duration_ms = Math.round(performance.now() - start);
  console.log(`  [${label}] completed in ${(duration_ms / 1000).toFixed(1)}s`);
  return { data, duration_ms, warnings: [] };
}

// ---------------------------------------------------------------------------
// Raw news item from any source
// ---------------------------------------------------------------------------

export const NewsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string(),
  summary: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  published_at: z.string().nullable().optional(),
  collected_at: z.string(),
  freshness: z.enum(["new", "resurfaced", "recurring"]).default("new"),
  project_url: z.string().nullable().optional(),
  tier: z.number().min(1).max(4).optional(),
  event_type: z.enum([
    "release",
    "blog_post",
    "trending",
    "velocity_spike",
    "viral_post",
    "community_discussion",
    "unknown",
  ]).optional(),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

// ---------------------------------------------------------------------------
// Editor output — curated stories + publishability decision
// ---------------------------------------------------------------------------

export const CuratedStorySchema = z.object({
  rank: z.number(),
  title: z.string(),
  url: z.string(),
  source: z.string(),
  one_liner: z.string(),
  significance: z.enum(["high", "medium"]),
  category: z.enum([
    "launch",
    "update",
    "research",
    "drama",
    "tutorial",
    "benchmark",
    "opinion",
  ]),
  news_item_ids: z.array(z.string()),
  reasoning: z.string(),
  project_url: z.string().nullable().optional(),
  has_visual: z.boolean().nullable().optional(),
});

export type CuratedStory = z.infer<typeof CuratedStorySchema>;

export const EditorialDecisionSchema = z.object({
  date: z.string(),
  publishable: z.boolean(),
  skip_reason: z.string().nullable().optional(),
  stories: z.array(CuratedStorySchema),
  total_raw: z.number(),
  skipped_count: z.number(),
  curated_at: z.string(),
});

export type EditorialDecision = z.infer<typeof EditorialDecisionSchema>;

// ---------------------------------------------------------------------------
// Resolved media from the Visuals Scout
// ---------------------------------------------------------------------------

export const ResolvedMediaSchema = z.object({
  local_path: z.string(),
  source: z.enum(["demo_gif", "screenshot", "diagram", "banner", "chart"]),
  alt: z.string(),
  content_type: z.string(),
});

export type ResolvedMedia = z.infer<typeof ResolvedMediaSchema>;

// ---------------------------------------------------------------------------
// Visual hint from the writer (machine-readable search criteria for the scout)
// ---------------------------------------------------------------------------

export const VisualHintSchema = z.object({
  description: z.string(),
  image_type: z.enum(["screenshot", "demo_gif", "diagram", "chart", "banner"]),
  product_name: z.string(),
  candidate_urls: z.array(z.string()).optional(),
});

export type VisualHint = z.infer<typeof VisualHintSchema>;

// ---------------------------------------------------------------------------
// Writer output — X thread (no external links — better algorithmic reach)
// ---------------------------------------------------------------------------

export const ThreadSegmentSchema = z.object({
  position: z.number(),
  text: z.string(),
  story_index: z.number().nullable().optional(),
  visual_hint: VisualHintSchema.optional(),
  media: ResolvedMediaSchema.optional(),
});

export type ThreadSegment = z.infer<typeof ThreadSegmentSchema>;

export const XThreadSchema = z.object({
  hook: z.string(),
  segments: z.array(ThreadSegmentSchema),
  cta: z.string(),
  grass_cta: z.string().optional(),
  grass_cta_reply: z.string().optional(),
});

export type XThread = z.infer<typeof XThreadSchema>;

// ---------------------------------------------------------------------------
// Writer output — Ghost companion post (source links + context)
// ---------------------------------------------------------------------------

export const CompanionPostSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export type CompanionPost = z.infer<typeof CompanionPostSchema>;

// ---------------------------------------------------------------------------
// Combined content from the writer agent
// ---------------------------------------------------------------------------

export const DigestContentSchema = z.object({
  date: z.string(),
  x_thread: XThreadSchema,
  companion_post: CompanionPostSchema,
  generated_at: z.string(),
});

export type DigestContent = z.infer<typeof DigestContentSchema>;

// ---------------------------------------------------------------------------
// Publish result
// ---------------------------------------------------------------------------

export const PublishResultSchema = z.object({
  typefully: z.object({
    draft_id: z.string().nullable(),
    private_url: z.string().nullable(),
    scheduled_at: z.string().nullable(),
    status: z.enum(["scheduled", "published", "draft", "failed", "skipped"]),
    error: z.string().nullable(),
  }),
  published_at: z.string(),
});

export type PublishResult = z.infer<typeof PublishResultSchema>;
