import { z } from "zod";

export const PublisherOutputSchema = z.object({
  packet_id: z.string(),
  surface_id: z.string(),
  title: z.string(),
  ghost_post_id: z.string(),
  ghost_post_url: z.string(),
  ghost_post_slug: z.string(),
  status: z.enum(["draft", "published"]),
  published_at: z.string().nullable(),
  created_at: z.string(),
  pipeline_created_at: z.string(),
  run_dir: z.string().default(""),
  strategist_output_path: z.string().default(""),
  tags: z.array(z.string()).default([]),
});

export type PublisherOutput = z.infer<typeof PublisherOutputSchema>;
