import Database from "better-sqlite3";
import { resolve } from "node:path";

const DEFAULT_DB_PATH = resolve(import.meta.dirname, "../../data/measurement.db");

/**
 * Initialize (or open) the measurement SQLite database.
 * Sets WAL mode and foreign keys, then creates all tables idempotently.
 */
export function initDb(dbPath?: string): Database.Database {
  const p = dbPath ?? process.env.MEASUREMENT_DB_PATH ?? DEFAULT_DB_PATH;
  const db = new Database(p);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      slug TEXT PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT NOT NULL,
      packet_id TEXT,
      surface_id TEXT,
      mode TEXT,
      format TEXT,
      voice_type TEXT,
      channel TEXT DEFAULT 'blog',
      asset_type TEXT DEFAULT 'canonical',
      geo_targets TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS prompts (
      prompt_id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_text TEXT UNIQUE NOT NULL,
      country TEXT DEFAULT 'us',
      intent_volume_monthly INTEGER DEFAULT 0,
      three_month_growth TEXT DEFAULT '',
      engines_tracked TEXT NOT NULL DEFAULT '[]',
      engine_count INTEGER GENERATED ALWAYS AS (json_array_length(engines_tracked)) STORED
    );

    CREATE TABLE IF NOT EXISTS citations (
      citation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id INTEGER NOT NULL REFERENCES prompts(prompt_id),
      engine TEXT NOT NULL,
      url TEXT NOT NULL,
      position INTEGER NOT NULL,
      date TEXT NOT NULL,
      domain TEXT NOT NULL,
      article_slug TEXT,
      brand_mentioned INTEGER DEFAULT 0,
      competitors_mentioned TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'otterly',
      UNIQUE(prompt_id, engine, url, date)
    );

    CREATE INDEX IF NOT EXISTS idx_citations_date ON citations(date);
    CREATE INDEX IF NOT EXISTS idx_citations_domain ON citations(domain);
    CREATE INDEX IF NOT EXISTS idx_citations_article_slug ON citations(article_slug);
    CREATE INDEX IF NOT EXISTS idx_citations_engine ON citations(engine);

    CREATE TABLE IF NOT EXISTS competitors (
      name TEXT PRIMARY KEY,
      domains TEXT DEFAULT '[]',
      source TEXT DEFAULT 'registry'
    );

    CREATE TABLE IF NOT EXISTS gsc_site_metrics (
      date TEXT PRIMARY KEY,
      impressions INTEGER,
      clicks INTEGER,
      ctr REAL
    );

    CREATE TABLE IF NOT EXISTS gsc_page_metrics (
      snapshot_date TEXT,
      url TEXT,
      impressions INTEGER,
      clicks INTEGER,
      ctr REAL,
      PRIMARY KEY (snapshot_date, url)
    );

    CREATE TABLE IF NOT EXISTS gsc_query_metrics (
      snapshot_date TEXT,
      query TEXT,
      impressions_7d INTEGER,
      clicks_7d INTEGER,
      impressions_28d INTEGER,
      clicks_28d INTEGER,
      ctr REAL,
      position REAL,
      is_branded INTEGER DEFAULT 0,
      PRIMARY KEY (snapshot_date, query)
    );
  `);

  return db;
}
