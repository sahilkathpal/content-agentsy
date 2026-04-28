import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RegistrySchema, type Registry, type Surface, type Subreddit, type Competitor, type WatchlistEntryType } from "../models/surface.js";

const REGISTRY_PATH = resolve(import.meta.dirname, "../../surfaces.json");

export function loadRegistry(): Registry {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  const data = JSON.parse(raw);
  return RegistrySchema.parse(data);
}

export interface SelectOptions {
  type?: "permanent" | "rotating";
  ids?: string[];
  maxTier?: 1 | 2 | 3;
}

export function selectSurfaces(registry: Registry, options?: SelectOptions): Surface[] {
  let surfaces = [...registry.surfaces];

  if (options?.type) {
    surfaces = surfaces.filter((s) => s.type === options.type);
  }
  if (options?.ids?.length) {
    const idSet = new Set(options.ids);
    surfaces = surfaces.filter((s) => idSet.has(s.id));
  }
  if (options?.maxTier) {
    surfaces = surfaces.filter((s) => s.tier <= options.maxTier!);
  }

  return surfaces.sort((a, b) => a.tier - b.tier);
}

export function getSubredditsForSurface(registry: Registry, surfaceId: string): Subreddit[] {
  return registry.subreddits.filter((sub) => sub.surface_ids.includes(surfaceId));
}

export function getCompetitorsForSurface(registry: Registry, surfaceId: string): Competitor[] {
  return registry.competitors.filter((c) => c.surface_ids.includes(surfaceId));
}

// ---------------------------------------------------------------------------
// Watchlist helpers (event-driven news monitoring)
// ---------------------------------------------------------------------------

export function getWatchlist(): WatchlistEntryType[] {
  const registry = loadRegistry();
  return registry.watchlist;
}

/** Flat list of all GitHub repos from the watchlist. */
export function getWatchlistRepos(): string[] {
  return getWatchlist().flatMap((w) => w.github_repos ?? []);
}

/** Map of lowercase alias → canonical watchlist name. */
export function getWatchlistAliases(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of getWatchlist()) {
    map.set(entry.name.toLowerCase(), entry.name);
    for (const alias of entry.aliases) {
      map.set(alias.toLowerCase(), entry.name);
    }
  }
  return map;
}

// Words that need context-aware matching (common English words)
const AMBIGUOUS_NAMES = new Set(["cursor", "amp", "modal", "goose", "aide", "bolt", "continue"]);
const CONTEXT_TERMS = /\b(AI|coding|editor|IDE|agent|Anysphere|Sourcegraph|code|developer|dev tool|LLM)\b/i;

/**
 * Build a regex that matches any watchlist name or alias.
 * For ambiguous names (Cursor, Amp, etc.), requires co-occurrence with context terms.
 * Returns both the simple regex and ambiguous names set for two-pass filtering.
 */
export function buildRelevanceMatchers(): {
  simpleRe: RegExp;
  ambiguousNames: Set<string>;
  contextRe: RegExp;
} {
  const watchlist = getWatchlist();
  const allTerms: string[] = [];

  for (const entry of watchlist) {
    const names = [entry.name, ...entry.aliases];
    for (const n of names) {
      if (!AMBIGUOUS_NAMES.has(n.toLowerCase())) {
        allTerms.push(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      }
    }
  }

  // Add domain-specific terms that are always relevant
  allTerms.push(
    "coding agent", "AI cod(?:ing|e)", "agentic", "vibe cod(?:ing|e)",
    "MCP", "model context protocol",
  );

  const simpleRe = new RegExp(`\\b(?:${allTerms.join("|")})\\b`, "i");
  return { simpleRe, ambiguousNames: AMBIGUOUS_NAMES, contextRe: CONTEXT_TERMS };
}
