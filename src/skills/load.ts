import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

/** Load a skill file by repo-relative path (as declared in config.json skills map). */
export function loadSkill(filePath: string): string {
  return readFileSync(resolve(ROOT, filePath), "utf-8");
}
