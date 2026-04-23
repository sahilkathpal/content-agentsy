import { z } from "zod";

export const SyndicationAssetSchema = z.object({
  platform: z.string(),
  title: z.string(),
  frontmatter: z.record(z.union([z.string(), z.boolean(), z.number(), z.array(z.string())])),
  markdown: z.string(),
  canonical_url_backlink: z.string(),
});

export const XThreadSchema = z.object({
  platform: z.literal("x_twitter"),
  segments: z.array(
    z.object({
      position: z.number(),
      text: z.string(),
      has_link: z.boolean(),
    })
  ),
  hook: z.string(),
  thread_cta: z.string(),
});

export const LinkedInPostSchema = z.object({
  platform: z.literal("linkedin"),
  text: z.string(),
  hook_line: z.string(),
  canonical_link: z.string(),
  hashtags: z.array(z.string()),
});

export const NativeUnitSchema = z.discriminatedUnion("platform", [
  XThreadSchema,
  LinkedInPostSchema,
]);

export const DerivativesOutputSchema = z.object({
  packet_id: z.string(),
  surface_id: z.string(),
  canonical_title: z.string(),
  canonical_slug: z.string(),
  syndication_assets: z.array(SyndicationAssetSchema),
  native_units: z.array(NativeUnitSchema),
  generation_stats: z.object({
    syndication_count: z.number(),
    native_unit_count: z.number(),
  }),
  created_at: z.string(),
});

export type SyndicationAsset = z.infer<typeof SyndicationAssetSchema>;
export type XThread = z.infer<typeof XThreadSchema>;
export type LinkedInPost = z.infer<typeof LinkedInPostSchema>;
export type NativeUnit = z.infer<typeof NativeUnitSchema>;
export type DerivativesOutput = z.infer<typeof DerivativesOutputSchema>;
