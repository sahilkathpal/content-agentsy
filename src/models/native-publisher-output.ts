import { z } from "zod";

const NativePlatformResultSchema = z.object({
  platform: z.enum(["x", "linkedin"]),
  status: z.enum(["drafted", "skipped", "failed"]),
  draft_id: z.string().nullable(),
  draft_url: z.string().nullable(),
  error: z.string().nullable(),
});

export const NativePublisherOutputSchema = z.object({
  packet_id: z.string(),
  results: z.array(NativePlatformResultSchema),
  created_at: z.string(),
});

export type NativePlatformResult = z.infer<typeof NativePlatformResultSchema>;
export type NativePublisherOutput = z.infer<typeof NativePublisherOutputSchema>;
