import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

export interface ContextEntry {
  topic: string;
  description: string;
  priority: number;
  consumers: string[];
  body: string;
}

const GRASS_DIR = resolve(ROOT, "content/pipelines/twitter-news/context");

/**
 * Parse flat YAML front matter from a markdown string.
 * Returns the parsed key-value pairs and the body after the closing `---`.
 */
function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2];
  }
  return { meta, body: match[2].trim() };
}

function loadFile(filePath: string): ContextEntry {
  const raw = readFileSync(filePath, "utf-8");
  const { meta, body } = parseFrontMatter(raw);
  return {
    topic: meta.topic ?? "",
    description: meta.description ?? "",
    priority: Number(meta.priority ?? 99),
    consumers: meta.consumers ? meta.consumers.split(",").map((s) => s.trim()) : [],
    body,
  };
}

/**
 * Load all .md files from the grass context directory, sorted by priority.
 */
export function loadAllContext(): ContextEntry[] {
  const files = readdirSync(GRASS_DIR).filter((f) => f.endsWith(".md"));
  return files.map((f) => loadFile(resolve(GRASS_DIR, f))).sort((a, b) => a.priority - b.priority);
}

/**
 * Load context entries filtered to a specific consumer key.
 * Throws if no context files match, which likely indicates a typo in the consumer key.
 */
export function loadContextForConsumer(consumer: string): ContextEntry[] {
  const all = loadAllContext();
  const matched = all.filter((entry) => entry.consumers.includes(consumer));
  if (matched.length === 0) {
    const available = [...new Set(all.flatMap((e) => e.consumers))].sort();
    throw new Error(
      `No context files matched consumer "${consumer}". Available consumers: ${available.join(", ")}`,
    );
  }
  return matched;
}

/**
 * Concatenate context entries into a single markdown string.
 */
export function buildContextString(contexts: ContextEntry[]): string {
  return contexts.map((c) => c.body).join("\n\n");
}

/**
 * Build a markdown index of all context files — topic, description, and path.
 * Agents use this to decide which files to Read at runtime.
 */
export function buildContextIndex(): string {
  const files = readdirSync(GRASS_DIR).filter((f) => f.endsWith(".md"));
  const entries = files
    .map((f) => loadFile(resolve(GRASS_DIR, f)))
    .sort((a, b) => a.priority - b.priority);

  const rows = entries.map(
    (e) => `| \`${e.topic}.md\` | ${e.description} |`,
  );

  return [
    "## Available Grass context files",
    "",
    "Read the files relevant to your task from `content/pipelines/twitter-news/context/`.",
    "",
    "| File | Description |",
    "|------|-------------|",
    ...rows,
  ].join("\n");
}
