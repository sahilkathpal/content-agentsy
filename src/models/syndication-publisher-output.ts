import { z } from "zod";

const PlatformResultSchema = z.object({
  platform: z.enum(["dev.to", "hashnode"]),
  status: z.enum(["published", "skipped", "failed"]),
  remote_id: z.string().nullable(),
  remote_url: z.string().nullable(),
  error: z.string().nullable(),
});

export const SyndicationPublisherOutputSchema = z.object({
  packet_id: z.string(),
  results: z.array(PlatformResultSchema),
  created_at: z.string(),
});

export type PlatformResult = z.infer<typeof PlatformResultSchema>;
export type SyndicationPublisherOutput = z.infer<typeof SyndicationPublisherOutputSchema>;
