import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WATCHLIST_PATH = resolve(import.meta.dirname, "../../content/watchlist.json");

export interface WatchlistEntry {
  name: string;
  github_repos: string[];
  github_org: string | null;
  official_blog_rss: string | null;
  aliases: string[];
  ambiguous?: boolean;
  category: string;
}

interface FeedConfig {
  name: string;
  url: string;
}

interface WatchlistFile {
  domain_terms: string[];
  context_terms: string[];
  x_domain_query: string;
  subreddits: string[];
  github_topics: string[];
  official_feeds: FeedConfig[];
  curated_feeds: FeedConfig[];
  watchlist: WatchlistEntry[];
}

function loadWatchlistFile(): WatchlistFile {
  const raw = readFileSync(WATCHLIST_PATH, "utf-8");
  return JSON.parse(raw) as WatchlistFile;
}

export function getWatchlist(): WatchlistEntry[] {
  return loadWatchlistFile().watchlist;
}

export function getSubreddits(): string[] {
  return loadWatchlistFile().subreddits;
}

export function getGithubTopics(): string[] {
  return loadWatchlistFile().github_topics;
}

export function getOfficialFeeds(): FeedConfig[] {
  return loadWatchlistFile().official_feeds;
}

export function getCuratedFeeds(): FeedConfig[] {
  return loadWatchlistFile().curated_feeds;
}

export function getXDomainQuery(): string {
  return loadWatchlistFile().x_domain_query;
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

/**
 * Build a regex that matches any watchlist name or alias.
 * Entries marked ambiguous: true require co-occurrence with a context term.
 * Domain terms and context terms are read from watchlist.json.
 */
export function buildRelevanceMatchers(): {
  simpleRe: RegExp;
  ambiguousNames: Set<string>;
  contextRe: RegExp;
} {
  const { watchlist, domain_terms, context_terms } = loadWatchlistFile();

  const ambiguousNames = new Set<string>();
  for (const entry of watchlist) {
    if (entry.ambiguous) {
      ambiguousNames.add(entry.name.toLowerCase());
      for (const alias of entry.aliases) {
        ambiguousNames.add(alias.toLowerCase());
      }
    }
  }

  const allTerms: string[] = [];
  for (const entry of watchlist) {
    for (const n of [entry.name, ...entry.aliases]) {
      if (!ambiguousNames.has(n.toLowerCase())) {
        allTerms.push(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      }
    }
  }

  for (const term of domain_terms) {
    allTerms.push(term);
  }

  const simpleRe = new RegExp(`\\b(?:${allTerms.join("|")})\\b`, "i");
  const contextRe = new RegExp(`\\b(?:${context_terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

  return { simpleRe, ambiguousNames, contextRe };
}
