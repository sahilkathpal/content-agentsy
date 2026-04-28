import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { DerivativesOutputSchema } from "../models/derivatives-output.js";
import { createNativeDraft } from "../tools/typefully.js";
import type { NativePublisherOutput } from "../models/native-publisher-output.js";

/**
 * Publish native units (X threads, LinkedIn posts) to Typefully as drafts.
 * No LLM call — pure API integration.
 */
export async function runNativePublisher(
  derivativesPath: string,
  outPath: string,
): Promise<NativePublisherOutput | null> {
  const raw = JSON.parse(readFileSync(derivativesPath, "utf-8"));
  const derivativesOutput = DerivativesOutputSchema.parse(raw);
  const { native_units } = derivativesOutput;

  if (native_units.length === 0) {
    console.log("[native-publisher] No native units found, skipping");
    return null;
  }

  if (!config.typefullyApiKey || !config.typefullySocialSetId) {
    const missing = [
      !config.typefullyApiKey && "TYPEFULLY_API_KEY",
      !config.typefullySocialSetId && "TYPEFULLY_SOCIAL_SET_ID",
    ].filter(Boolean).join(", ");
    console.log(`[native-publisher] Missing ${missing} — skipping Typefully`);

    const output: NativePublisherOutput = {
      packet_id: derivativesOutput.packet_id,
      results: native_units.map((u) => ({
        platform: u.platform === "x_twitter" ? "x" as const : "linkedin" as const,
        status: "skipped" as const,
        draft_id: null,
        draft_url: null,
        error: `Missing env: ${missing}`,
      })),
      created_at: new Date().toISOString(),
    };
    writeFileSync(outPath, JSON.stringify(output, null, 2));
    return output;
  }

  console.log(`[native-publisher] Creating Typefully draft for ${native_units.length} native unit(s)…`);
  const results = await createNativeDraft(native_units);

  const output: NativePublisherOutput = {
    packet_id: derivativesOutput.packet_id,
    results,
    created_at: new Date().toISOString(),
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));

  const drafted = results.filter((r) => r.status === "drafted").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`[native-publisher] Done: ${drafted} drafted, ${failed} failed`);

  return output;
}
