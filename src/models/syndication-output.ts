import { z } from "zod";
import { SyndicationAssetSchema } from "./derivatives-output.js";

/**
 * Output written by the syndication generator after a Ghost post is published.
 * Stored as syndication-output.json in the packet directory.
 * Separate from derivatives-output.json which is for native units.
 */
export const SyndicationOutputSchema = z.object({
  packet_id: z.string(),
  canonical_slug: z.string(),
  canonical_url: z.string(),
  assets: z.array(SyndicationAssetSchema),
  created_at: z.string(),
});

export type SyndicationOutput = z.infer<typeof SyndicationOutputSchema>;
