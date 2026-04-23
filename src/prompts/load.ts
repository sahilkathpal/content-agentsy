import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROMPTS_DIR = resolve(import.meta.dirname);

/**
 * Load a prompt template and fill in {{placeholders}}.
 */
export function loadPrompt(name: string, vars: Record<string, string>): string {
  const raw = readFileSync(resolve(PROMPTS_DIR, `${name}.md`), "utf-8");
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
