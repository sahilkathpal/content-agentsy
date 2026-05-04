/**
 * Pure TypeScript logic for the editorial pipeline — no LLM calls.
 * Imported by both news-editor.ts and editorial-tools.ts.
 */

import type { NewsItem, EditorialDecision } from "../models/digest.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface EventCluster {
  id: string;
  primary: NewsItem;
  all_items: NewsItem[];
  source_count: number;
  max_score: number;
  total_comments: number;
  has_official_source: boolean;
  has_community_validation: boolean;
}

export interface ClusterSignals {
  age_hours: number;
  source_breadth: number;
  tier_best: 1 | 2 | 3 | 4;
  event_type: string;
  engagement_level: "none" | "low" | "moderate" | "high";
}

export interface PreparedCluster {
  cluster: EventCluster;
  signals: ClusterSignals;
}

export interface EditorialJudgment {
  cluster_id: string;
  include: boolean;
  newsworthiness: "must_tell" | "solid" | "filler" | "skip";
  reasoning: string;
  lead_angle: string;
  category: "launch" | "update" | "research" | "drama" | "tutorial" | "benchmark" | "opinion";
}

const MAX_CLUSTERS_FOR_EDITOR = 40;

// ---------------------------------------------------------------------------
// Hard-drop filters
// ---------------------------------------------------------------------------

const META_PATTERNS = [
  /^what is the best\b/i,
  /^who'?s using\b/i,
  /^are there any\b/i,
  /^can someone\b/i,
  /^how do you\b/i,
  /\bweekly\s+discussion\b/i,
  /\bmonthly\s+thread\b/i,
  /\bjob\s+post/i,
  /\bwebinar\b/i,
  /\bcourse\b.*\benroll/i,
  /\bawesome[\s-]list\b/i,
  /\bnewsletter\s+roundup\b/i,
];

function hardDrop(item: NewsItem, now: number): string | null {
  const ts = item.published_at ?? item.collected_at;
  const ageMs = now - new Date(ts).getTime();
  if (ageMs > 72 * 60 * 60 * 1000) return "stale (>72h)";

  for (const pattern of META_PATTERNS) {
    if (pattern.test(item.title)) return `meta pattern: ${pattern.source}`;
  }

  if (item.source === "github" && item.summary) {
    const createdMatch = item.summary.match(/\[repo created: (\d{4}-\d{2}-\d{2})\]/);
    if (createdMatch) {
      const createdAge = now - new Date(createdMatch[1]).getTime();
      if (createdAge > 30 * 24 * 60 * 60 * 1000) {
        if (item.event_type === "trending" || item.event_type === "unknown" || !item.event_type) {
          return "old repo, no news event";
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

function bigramDice(a: string, b: string): number {
  const bigrams = (s: string) => {
    const tokens = s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    const bg = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) bg.add(`${tokens[i]} ${tokens[i + 1]}`);
    return bg;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const bg of setA) if (setB.has(bg)) intersection++;
  return (2 * intersection) / (setA.size + setB.size);
}

function normalizeForCluster(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/[#?].*$/, "").replace(/\/$/, "");
  }
}

export function sourceType(source: string): string {
  if (source.startsWith("reddit")) return "reddit";
  if (source.startsWith("rss")) return "rss";
  return source.split("/")[0];
}

function buildCluster(items: NewsItem[]): EventCluster {
  const sorted = [...items].sort((a, b) => {
    const tierDiff = (a.tier ?? 4) - (b.tier ?? 4);
    if (tierDiff !== 0) return tierDiff;
    return (b.score ?? 0) - (a.score ?? 0);
  });
  const primary = sorted[0];
  const sourceTypes = new Set(items.map((i) => sourceType(i.source)));
  const maxScore = Math.max(...items.map((i) => i.score ?? 0));
  const totalComments = items.reduce((sum, i) => sum + (i.num_comments ?? 0), 0);

  return {
    id: primary.id,
    primary,
    all_items: items,
    source_count: sourceTypes.size,
    max_score: maxScore,
    total_comments: totalComments,
    has_official_source: items.some((i) => (i.tier ?? 4) === 1),
    has_community_validation: items.some((i) => (i.tier ?? 4) <= 2),
  };
}

function mergeSimilarClusters(clusters: EventCluster[], threshold: number): EventCluster[] {
  const active = [...clusters];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const sim = bigramDice(active[i].primary.title, active[j].primary.title);
        if (sim > threshold) {
          active[i] = buildCluster([...active[i].all_items, ...active[j].all_items]);
          active.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return active;
}

function clusterItems(items: NewsItem[]): EventCluster[] {
  const urlGroups = new Map<string, NewsItem[]>();
  for (const item of items) {
    const key = normalizeForCluster(item.url);
    if (!urlGroups.has(key)) urlGroups.set(key, []);
    urlGroups.get(key)!.push(item);
  }
  const clusters: EventCluster[] = [];
  for (const [, group] of urlGroups) clusters.push(buildCluster(group));
  return mergeSimilarClusters(clusters, 0.4);
}

function enrichCluster(cluster: EventCluster, now: number): ClusterSignals {
  const ts = cluster.primary.published_at ?? cluster.primary.collected_at;
  const ageMs = now - new Date(ts).getTime();
  const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
  const engagement = cluster.max_score;
  const engagementLevel: ClusterSignals["engagement_level"] =
    engagement <= 0 ? "none"
    : engagement < 10 ? "low"
    : engagement < 50 ? "moderate"
    : "high";

  return {
    age_hours: Math.round(ageHours * 10) / 10,
    source_breadth: cluster.source_count,
    tier_best: Math.min(...cluster.all_items.map((i) => i.tier ?? 4)) as 1 | 2 | 3 | 4,
    event_type: cluster.primary.event_type ?? "unknown",
    engagement_level: engagementLevel,
  };
}

// ---------------------------------------------------------------------------
// Public: Phase 1 — prepare clusters for editorial judgment
// ---------------------------------------------------------------------------

export function prepareForEditor(items: NewsItem[]): { prepared: PreparedCluster[]; dropCount: number } {
  const now = Date.now();

  const surviving: NewsItem[] = [];
  let dropCount = 0;
  for (const item of items) {
    const reason = hardDrop(item, now);
    if (reason) {
      dropCount++;
    } else {
      surviving.push(item);
    }
  }
  console.log(`  [editor] hard-dropped ${dropCount} items, ${surviving.length} surviving`);

  const clusters = clusterItems(surviving);
  console.log(`  [editor] ${surviving.length} items → ${clusters.length} clusters`);

  const prepared: PreparedCluster[] = clusters.map((cluster) => ({
    cluster,
    signals: enrichCluster(cluster, now),
  }));

  const engagementOrder = { high: 0, moderate: 1, low: 2, none: 3 };
  prepared.sort((a, b) => {
    if (b.signals.source_breadth !== a.signals.source_breadth)
      return b.signals.source_breadth - a.signals.source_breadth;
    if (a.signals.tier_best !== b.signals.tier_best)
      return a.signals.tier_best - b.signals.tier_best;
    if (a.signals.engagement_level !== b.signals.engagement_level)
      return engagementOrder[a.signals.engagement_level] - engagementOrder[b.signals.engagement_level];
    return a.signals.age_hours - b.signals.age_hours;
  });

  const capped = prepared.slice(0, MAX_CLUSTERS_FOR_EDITOR);
  if (prepared.length > MAX_CLUSTERS_FOR_EDITOR) {
    console.log(`  [editor] capped from ${prepared.length} to ${capped.length} clusters`);
  }

  return { prepared: capped, dropCount };
}

// ---------------------------------------------------------------------------
// Public: Phase 3 — build final decision from editorial judgments
// ---------------------------------------------------------------------------

export function buildEditorialDecision(
  prepared: PreparedCluster[],
  judgments: EditorialJudgment[],
  totalRaw: number,
  dropCount: number,
): EditorialDecision {
  const date = new Date().toISOString().slice(0, 10);

  const judgmentMap = new Map<string, EditorialJudgment>();
  for (const j of judgments) judgmentMap.set(j.cluster_id, j);

  const included: { prepared: PreparedCluster; judgment: EditorialJudgment }[] = [];
  for (const p of prepared) {
    const j = judgmentMap.get(p.cluster.id);
    if (j?.include) included.push({ prepared: p, judgment: j });
  }

  const worthinessOrder = { must_tell: 0, solid: 1, filler: 2, skip: 3 };
  included.sort((a, b) => {
    const wDiff = worthinessOrder[a.judgment.newsworthiness] - worthinessOrder[b.judgment.newsworthiness];
    if (wDiff !== 0) return wDiff;
    if (b.prepared.signals.source_breadth !== a.prepared.signals.source_breadth)
      return b.prepared.signals.source_breadth - a.prepared.signals.source_breadth;
    return a.prepared.signals.tier_best - b.prepared.signals.tier_best;
  });

  // Source diversity cap
  const sourceTypeCounts = new Map<string, number>();
  for (const { prepared: p } of included) {
    const st = sourceType(p.cluster.primary.source);
    sourceTypeCounts.set(st, (sourceTypeCounts.get(st) ?? 0) + 1);
  }
  const totalIncluded = included.length;
  if (totalIncluded > 2) {
    for (const [st, count] of sourceTypeCounts) {
      if (count / totalIncluded > 0.5) {
        const maxAllowed = Math.ceil(totalIncluded / 2);
        let seen = 0;
        for (let i = 0; i < included.length; i++) {
          if (sourceType(included[i].prepared.cluster.primary.source) === st) {
            seen++;
            if (seen > maxAllowed) {
              const [item] = included.splice(i, 1);
              included.push(item);
              i--;
            }
          }
        }
      }
    }
  }

  const capped = included.slice(0, 10);
  const publishable = capped.length > 0;

  const stories = capped.map(({ prepared: p, judgment: j }, i) => ({
    rank: i + 1,
    title: p.cluster.primary.title,
    url: p.cluster.primary.url,
    source: p.cluster.primary.source,
    one_liner: j.lead_angle,
    significance: j.newsworthiness === "must_tell" ? "high" as const : "medium" as const,
    category: j.category,
    news_item_ids: p.cluster.all_items.map((item) => item.id),
    reasoning: j.reasoning,
    project_url: p.cluster.all_items.find((item) => item.project_url)?.project_url ?? null,
    has_visual: null as boolean | null,
  }));

  return {
    date,
    publishable,
    skip_reason: publishable ? null : "No stories passed editorial judgment",
    stories,
    total_raw: totalRaw,
    skipped_count: totalRaw - stories.length,
    curated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Formatting helper (used by editorial tools to show clusters to Claude)
// ---------------------------------------------------------------------------

export function formatClustersForPrompt(prepared: PreparedCluster[]): string {
  return prepared.map((p, i) => {
    const c = p.cluster;
    const s = p.signals;

    const sourceParts = c.all_items.map((item) => {
      const parts = [item.source];
      if (item.score) parts.push(`${item.score} pts`);
      if (item.num_comments) parts.push(`${item.num_comments} comments`);
      return parts.join(" ");
    });
    const uniqueSources = [...new Set(sourceParts)];

    const lines = [
      `### Cluster ${i + 1} [id: ${c.id}]`,
      `**${c.primary.title}**`,
      `URL: ${c.primary.url}`,
    ];

    if (c.primary.summary) {
      lines.push(`Summary: ${c.primary.summary.slice(0, 300)}`);
    }

    lines.push(`Sources: ${uniqueSources.join(" · ")}`);
    lines.push(`Age: ${s.age_hours < 1 ? "< 1 hour" : `${Math.round(s.age_hours)} hours`} · Event: ${s.event_type} · Engagement: ${s.engagement_level}${c.max_score > 0 ? ` (${c.max_score} max score, ${c.total_comments} total comments)` : ""}`);

    if (c.source_count > 1) lines.push(`Cross-source: covered by ${c.source_count} distinct source types`);
    if (c.has_official_source) lines.push(`Official source (T1) present`);

    return lines.join("\n");
  }).join("\n\n");
}
