import { readFileSync } from "node:fs";

// ── Row types ────────────────────────────────────────────────────────

export interface OtterlyPromptRow {
  prompt: string;
  country: string;
  tags: string;
  intent_volume_monthly: number;
  three_month_growth: string;
  total_citations: number;
  your_brand_mentioned: number | null; // "-" → null
  all_engines_your_brand_rank: number | null;
  your_domain_cited: number | null;
  /** Remaining competitor columns as key-value pairs */
  competitors: Record<string, { mentioned: number; cited: number }>;
}

export interface OtterlyCitationRow {
  prompt: string;
  country: string;
  service: string; // perplexity, copilot, chatgpt, google
  title: string;
  url: string;
  position: number;
  date: string;
  domain: string;
  domain_category: string;
  my_brand_mentioned: boolean;
  competitors_mentioned: string;
}

// ── Aggregation result ───────────────────────────────────────────────

export interface OtterlyAggregation {
  llm_citation_count: number;
  ai_search_inclusion: Record<string, boolean>;
  target_prompts_tracked: string[];
  brand_mention_count: number;
  best_brand_rank: number | null;
}

// ── CSV parsing ──────────────────────────────────────────────────────

/**
 * Parse a CSV line respecting quoted fields (handles commas inside quotes).
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseDashNumber(val: string): number | null {
  if (val === "-" || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ── Parsers ──────────────────────────────────────────────────────────

export function parsePromptsCsv(csvPath: string): OtterlyPromptRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: OtterlyPromptRow[] = [];

  // Identify competitor columns (after the fixed columns)
  // Fixed: Prompt, Country, Tags, Intent Volume Monthly, 3-month growth,
  //        Total citations, Your brand mentioned, All Engines your brand rank,
  //        Your domain cited
  const FIXED_COUNT = 9;
  const competitorHeaders: Array<{ name: string; type: "mentioned" | "cited" }> = [];
  for (let i = FIXED_COUNT; i < headers.length; i++) {
    const h = headers[i];
    const mentionedMatch = h.match(/^(.+?) mentioned$/);
    const citedMatch = h.match(/^(.+?) cited$/);
    if (mentionedMatch) {
      competitorHeaders.push({ name: mentionedMatch[1], type: "mentioned" });
    } else if (citedMatch) {
      competitorHeaders.push({ name: citedMatch[1], type: "cited" });
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < FIXED_COUNT) continue;

    const competitors: Record<string, { mentioned: number; cited: number }> = {};
    for (let j = 0; j < competitorHeaders.length; j++) {
      const ch = competitorHeaders[j];
      const val = Number(fields[FIXED_COUNT + j] ?? "0") || 0;
      if (!competitors[ch.name]) competitors[ch.name] = { mentioned: 0, cited: 0 };
      competitors[ch.name][ch.type] = val;
    }

    rows.push({
      prompt: fields[0],
      country: fields[1],
      tags: fields[2],
      intent_volume_monthly: Number(fields[3]) || 0,
      three_month_growth: fields[4],
      total_citations: Number(fields[5]) || 0,
      your_brand_mentioned: parseDashNumber(fields[6]),
      all_engines_your_brand_rank: parseDashNumber(fields[7]),
      your_domain_cited: parseDashNumber(fields[8]),
      competitors,
    });
  }

  return rows;
}

export function parseCitationsCsv(csvPath: string): OtterlyCitationRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const rows: OtterlyCitationRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 11) continue;

    rows.push({
      prompt: fields[0],
      country: fields[1],
      service: fields[2],
      title: fields[3],
      url: fields[4],
      position: Number(fields[5]) || 0,
      date: fields[6],
      domain: fields[7],
      domain_category: fields[8],
      my_brand_mentioned: fields[9].toLowerCase() === "yes",
      competitors_mentioned: fields[10],
    });
  }

  return rows;
}

// ── Aggregation ──────────────────────────────────────────────────────

/**
 * Aggregate Otterly data for a given domain into scorecard-ready GEO fields.
 */
export function aggregateForDomain(
  prompts: OtterlyPromptRow[],
  citations: OtterlyCitationRow[],
  domain: string,
): OtterlyAggregation {
  const domainLower = domain.toLowerCase();

  // Count citations where the domain matches
  const domainCitations = citations.filter(
    (c) => c.domain.toLowerCase() === domainLower || c.url.toLowerCase().includes(domainLower),
  );

  // AI search inclusion — which engines cite us?
  const engines = new Set(citations.map((c) => c.service));
  const aiSearchInclusion: Record<string, boolean> = {};
  for (const engine of engines) {
    aiSearchInclusion[engine] = domainCitations.some((c) => c.service === engine);
  }

  // Unique prompts tracked
  const targetPrompts = [...new Set(prompts.map((p) => p.prompt))];

  // Brand mention count from prompts CSV
  const brandMentionCount = prompts.reduce(
    (sum, p) => sum + (p.your_brand_mentioned ?? 0),
    0,
  );

  // Best brand rank
  const ranks = prompts
    .map((p) => p.all_engines_your_brand_rank)
    .filter((r): r is number => r !== null);
  const bestBrandRank = ranks.length > 0 ? Math.min(...ranks) : null;

  return {
    llm_citation_count: domainCitations.length,
    ai_search_inclusion: aiSearchInclusion,
    target_prompts_tracked: targetPrompts,
    brand_mention_count: brandMentionCount,
    best_brand_rank: bestBrandRank,
  };
}
