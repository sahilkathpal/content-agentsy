import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

export function loadFixture<T>(name: string): T {
  const p = resolve(FIXTURES_DIR, name);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

export function saveFixture(name: string, data: unknown): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const p = resolve(FIXTURES_DIR, name);
  writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`  [harness] saved ${name}`);
}

export function assertShape<T>(schema: z.ZodSchema<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[FAIL] ${label} shape invalid:`);
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
  console.log(`[PASS] ${label}`);
  return result.data;
}

export function printSummary(label: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  console.log(`\n=== ${label} ===`);
  console.log(text.length > 3000 ? text.slice(0, 3000) + "\n…(truncated)" : text);
}

export const LIVE = process.argv.includes("--live");
export const REVIEW = process.argv.includes("--review");
