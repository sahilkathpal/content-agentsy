import type Database from "better-sqlite3";
import { initDb } from "./schema.js";
import type { AssetEntry } from "../models/asset-manifest.js";

const DOMAIN = "codeongrass.com";

let _db: Database.Database | null = null;

/** Singleton accessor for the measurement database. */
export function getDb(): Database.Database {
  if (!_db) _db = initDb();
  return _db;
}

/** Extract slug from a codeongrass.com URL, or null if not our domain. */
export function slugFromUrl(url: string, domain: string = DOMAIN): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(domain)) return null;
    // Strip leading/trailing slashes, take last segment
    const parts = u.pathname.replace(/^\/|\/$/g, "").split("/");
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

/** INSERT OR REPLACE an article row from an AssetEntry. */
export function upsertArticle(entry: AssetEntry): void {
  const db = getDb();
  const slug = entry.slug || slugFromUrl(entry.published_url ?? "", DOMAIN);
  if (!slug || !entry.published_url) return;

  db.prepare(`
    INSERT OR REPLACE INTO articles
      (slug, url, title, published_at, packet_id, surface_id, mode, format,
       voice_type, channel, asset_type, geo_targets)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug,
    entry.published_url,
    entry.title,
    entry.published_at ?? new Date().toISOString(),
    entry.packet_id,
    entry.surface_id,
    entry.mode,
    entry.format,
    entry.voice_type,
    entry.channel,
    entry.asset_type,
    JSON.stringify(entry.geo_targets),
  );
}

/** Merge two engine arrays into a sorted union. */
export function mergeEnginesTracked(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

/**
 * Upsert a prompt row. On conflict (same prompt_text), merges engines_tracked.
 * Returns the prompt_id.
 */
export function upsertPrompt(
  text: string,
  engines: string[],
  volume?: number,
  growth?: string,
): number {
  const db = getDb();

  const existing = db.prepare(
    `SELECT prompt_id, engines_tracked FROM prompts WHERE prompt_text = ?`
  ).get(text) as { prompt_id: number; engines_tracked: string } | undefined;

  if (existing) {
    const merged = mergeEnginesTracked(
      JSON.parse(existing.engines_tracked) as string[],
      engines,
    );
    db.prepare(`
      UPDATE prompts SET engines_tracked = ?, intent_volume_monthly = COALESCE(?, intent_volume_monthly),
        three_month_growth = COALESCE(?, three_month_growth)
      WHERE prompt_id = ?
    `).run(JSON.stringify(merged), volume ?? null, growth ?? null, existing.prompt_id);
    return existing.prompt_id;
  }

  const result = db.prepare(`
    INSERT INTO prompts (prompt_text, engines_tracked, intent_volume_monthly, three_month_growth)
    VALUES (?, ?, ?, ?)
  `).run(text, JSON.stringify(engines), volume ?? 0, growth ?? "");

  return Number(result.lastInsertRowid);
}

/**
 * Insert a citation row. Uses INSERT OR IGNORE for natural dedup on the unique constraint.
 */
export function upsertCitation(opts: {
  prompt_id: number;
  engine: string;
  url: string;
  position: number;
  date: string;
  domain: string;
  article_slug?: string | null;
  brand_mentioned?: number;
  competitors_mentioned?: string;
  source?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO citations
      (prompt_id, engine, url, position, date, domain, article_slug,
       brand_mentioned, competitors_mentioned, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.prompt_id,
    opts.engine,
    opts.url,
    opts.position,
    opts.date,
    opts.domain,
    opts.article_slug ?? null,
    opts.brand_mentioned ?? 0,
    opts.competitors_mentioned ?? "",
    opts.source ?? "otterly",
  );
}

/** Upsert a competitor into the competitors table. */
export function upsertCompetitor(name: string, domains: string[] = [], source: string = "registry"): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO competitors (name, domains, source) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      domains = CASE WHEN excluded.domains != '[]' THEN excluded.domains ELSE competitors.domains END,
      source = excluded.source
  `).run(name, JSON.stringify(domains), source);
}
