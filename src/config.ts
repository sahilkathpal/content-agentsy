import "dotenv/config";

export const config = {
  parallelApiKey: process.env.PARALLEL_API_KEY ?? "",
  typefullyApiKey: process.env.TYPEFULLY_API_KEY ?? "",
  typefullySocialSetId: process.env.TYPEFULLY_SOCIAL_SET_ID ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
} as const;

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
