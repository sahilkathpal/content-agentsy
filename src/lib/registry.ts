import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WATCHLIST_PATH = resolve(import.meta.dirname, "../../content/watchlist.json");

export interface WatchlistEntry {
  name: string;
  github_repos: string[];
  github_org: string | null;
  official_blog_rss: string | null;
  aliases: string[];
  category: string;
}

function loadWatchlist(): WatchlistEntry[] {
  const raw = readFileSync(WATCHLIST_PATH, "utf-8");
  const data = JSON.parse(raw) as { watchlist: WatchlistEntry[] };
  return data.watchlist;
}

export function getWatchlist(): WatchlistEntry[] {
  return loadWatchlist();
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
