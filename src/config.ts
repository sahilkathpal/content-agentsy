import "dotenv/config";

export const config = {
  parallelApiKey: process.env.PARALLEL_API_KEY ?? "",
  ghostUrl: process.env.GHOST_URL ?? "",
  ghostAdminKey: process.env.GHOST_ADMIN_KEY ?? "",
  ghostContentKey: process.env.GHOST_CONTENT_KEY ?? "",
  siteName: process.env.SITE_NAME ?? "",
  llmsOutputDir: process.env.LLMS_OUTPUT_DIR ?? "",
  devtoApiKey: process.env.DEVTO_API_KEY ?? "",
  hashnodePat: process.env.HASHNODE_PAT ?? "",
  hashnodePublicationId: process.env.HASHNODE_PUBLICATION_ID ?? "",
  ghostWebhookSecret: process.env.GHOST_WEBHOOK_SECRET ?? "",
  typefullyApiKey: process.env.TYPEFULLY_API_KEY ?? "",
  typefullySocialSetId: process.env.TYPEFULLY_SOCIAL_SET_ID ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
} as const;

export const webhookPort = process.env.WEBHOOK_PORT ? Number(process.env.WEBHOOK_PORT) : 3456;

export function requireKey(name: keyof typeof config): string {
  const val = config[name];
  if (!val) throw new Error(`Missing env var for ${name} — check .env`);
  return val;
}

/**
 * Validate that all required env vars are set.
 * Call at startup to fail fast instead of halfway through a pipeline run.
 */
export function validateConfig(requiredKeys: Array<keyof typeof config>): void {
  const missing = requiredKeys.filter((k) => !config[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}\n` +
      `Copy .env.example to .env and fill in the values.`
    );
  }
}
