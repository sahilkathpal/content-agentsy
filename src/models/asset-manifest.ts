import { z } from "zod";
import { IntentMode, VoiceType, AssetType } from "./scorecard.js";

export const AssetEntrySchema = z.object({
  asset_id: z.string(),
  packet_id: z.string(),
  surface_id: z.string(),
  mode: IntentMode,
  format: z.string(),
  voice_type: VoiceType,
  channel: z.string(),
  asset_type: AssetType,
  title: z.string(),
  slug: z.string(),
  published_url: z.string().nullable(),
  published_at: z.string().nullable(),
  geo_targets: z.array(z.string()),
});

export type AssetEntry = z.infer<typeof AssetEntrySchema>;
