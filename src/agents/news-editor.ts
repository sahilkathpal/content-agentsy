import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { EditorialDecisionSchema, type EditorialDecision, type NewsItem } from "../models/digest.js";

// ---------------------------------------------------------------------------
// Internal types (not exported — only used within the editor)
// ---------------------------------------------------------------------------

interface EventCluster {
  id: string;
  primary: NewsItem;
  all_items: NewsItem[];
  source_count: number;
  max_score: number;
  total_comments: number;
  has_official_source: boolean;
  has_community_validation: boolean;
}

interface ClusterSignals {
  age_hours: number;
  source_breadth: number;
  tier_best: 1 | 2 | 3 | 4;
  event_type: string;
  engagement_level: "none" | "low" | "moderate" | "high";
}

interface PreparedCluster {
  cluster: EventCluster;
  signals: ClusterSignals;
}

interface EditorialJudgment {
  cluster_id: string;
  include: boolean;
  newsworthiness: "must_tell" | "solid" | "filler" | "skip";
  reasoning: string;
  lead_angle: string;
  category: "launch" | "update" | "research" | "drama" | "tutorial" | "benchmark" | "opinion";
}

const MAX_CLUSTERS_FOR_EDITOR = 40;

// ---------------------------------------------------------------------------
// Phase 1: Code pre-processing
// ---------------------------------------------------------------------------

/** Regex patterns for meta/non-news content that should never reach the editor */
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
  // Stale: older than 72 hours
  const ts = item.published_at ?? item.collected_at;
  const ageMs = now - new Date(ts).getTime();
  if (ageMs > 72 * 60 * 60 * 1000) return "stale (>72h)";

  // Meta/non-news patterns
  for (const pattern of META_PATTERNS) {
    if (pattern.test(item.title)) return `meta pattern: ${pattern.source}`;
  }

  // Old repo with no news: GitHub trending item created >30 days ago
  if (item.source === "github" && item.summary) {
    const createdMatch = item.summary.match(/\[repo created: (\d{4}-\d{2}-\d{2})\]/);
    if (createdMatch) {
      const createdAge = now - new Date(createdMatch[1]).getTime();
      if (createdAge > 30 * 24 * 60 * 60 * 1000) {
        // Only drop if event_type is "trending" (no release/blog_post backing it)
        if (item.event_type === "trending" || item.event_type === "unknown" || !item.event_type) {
          return "old repo, no news event";
        }
      }
    }
  }

  return null;
}

/**
 * Bigram Dice coefficient for title similarity.
 * Returns 0-1 where 1 = identical bigram sets.
 */
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

/** Normalize a URL for dedup purposes (strip protocol, www, trailing slash, query, fragment) */
function normalizeForCluster(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/[#?].*$/, "").replace(/\/$/, "");
  }
}

/** Source type for diversity checks (collapse subreddit variants, rss variants, etc.) */
function sourceType(source: string): string {
  if (source.startsWith("reddit")) return "reddit";
  if (source.startsWith("rss")) return "rss";
  return source.split("/")[0];
}

function clusterItems(items: NewsItem[]): EventCluster[] {
  // Step 1: Group by normalized URL
  const urlGroups = new Map<string, NewsItem[]>();
  for (const item of items) {
    const key = normalizeForCluster(item.url);
    if (!urlGroups.has(key)) urlGroups.set(key, []);
    urlGroups.get(key)!.push(item);
  }

  // Convert URL groups into initial clusters
  const clusters: EventCluster[] = [];
  for (const [, group] of urlGroups) {
    clusters.push(buildCluster(group));
  }

  // Step 2: Merge clusters with similar titles (bigram Dice > 0.4)
  const merged = mergeSimilarClusters(clusters, 0.4);

  return merged;
}

function buildCluster(items: NewsItem[]): EventCluster {
  // Pick primary: lowest tier (best), then highest score
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
  // Simple greedy merge: compare each pair, merge if title similarity > threshold
  const active = [...clusters];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const sim = bigramDice(active[i].primary.title, active[j].primary.title);
        if (sim > threshold) {
          // Merge j into i
          const merged = buildCluster([...active[i].all_items, ...active[j].all_items]);
          active[i] = merged;
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

function enrichCluster(cluster: EventCluster, now: number): ClusterSignals {
  const ts = cluster.primary.published_at ?? cluster.primary.collected_at;
  const ageMs = now - new Date(ts).getTime();
  const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));

  const engagement = cluster.max_score;
  const engagementLevel: ClusterSignals["engagement_level"] =
    engagement <= 0 ? "none" :
    engagement < 10 ? "low" :
    engagement < 50 ? "moderate" :
    "high";

  return {
    age_hours: Math.round(ageHours * 10) / 10,
    source_breadth: cluster.source_count,
    tier_best: Math.min(...cluster.all_items.map((i) => i.tier ?? 4)) as 1 | 2 | 3 | 4,
    event_type: cluster.primary.event_type ?? "unknown",
    engagement_level: engagementLevel,
  };
}

function prepareForEditor(items: NewsItem[]): { prepared: PreparedCluster[]; dropCount: number } {
  const now = Date.now();

  // Phase 1a: Hard drops
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

  // Phase 1b: Cluster
  const clusters = clusterItems(surviving);
  console.log(`  [editor] ${surviving.length} items → ${clusters.length} clusters`);

  // Phase 1c: Enrich
  const prepared: PreparedCluster[] = clusters.map((cluster) => ({
    cluster,
    signals: enrichCluster(cluster, now),
  }));

  // Phase 1d: Sort and cap
  const engagementOrder = { high: 0, moderate: 1, low: 2, none: 3 };
  prepared.sort((a, b) => {
    // Source breadth desc
    if (b.signals.source_breadth !== a.signals.source_breadth)
      return b.signals.source_breadth - a.signals.source_breadth;
    // Tier best asc
    if (a.signals.tier_best !== b.signals.tier_best)
      return a.signals.tier_best - b.signals.tier_best;
    // Engagement level desc
    if (a.signals.engagement_level !== b.signals.engagement_level)
      return engagementOrder[a.signals.engagement_level] - engagementOrder[b.signals.engagement_level];
    // Age asc (fresher first)
    return a.signals.age_hours - b.signals.age_hours;
  });

  const capped = prepared.slice(0, MAX_CLUSTERS_FOR_EDITOR);
  if (prepared.length > MAX_CLUSTERS_FOR_EDITOR) {
    console.log(`  [editor] capped from ${prepared.length} to ${capped.length} clusters`);
  }

  return { prepared: capped, dropCount };
}

// ---------------------------------------------------------------------------
// Phase 2: LLM editorial judgment
// ---------------------------------------------------------------------------

function formatClustersForPrompt(prepared: PreparedCluster[]): string {
  return prepared.map((p, i) => {
    const c = p.cluster;
    const s = p.signals;

    // Build human-readable source line
    const sourceParts = c.all_items.map((item) => {
      const parts = [item.source];
      if (item.score) parts.push(`${item.score} pts`);
      if (item.num_comments) parts.push(`${item.num_comments} comments`);
      return parts.join(" ");
    });
    // Deduplicate if same source appears multiple times
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

    if (c.source_count > 1) {
      lines.push(`Cross-source: covered by ${c.source_count} distinct source types`);
    }
    if (c.has_official_source) {
      lines.push(`Official source (T1) present`);
    }

    return lines.join("\n");
  }).join("\n\n");
}

async function getEditorialJudgments(prepared: PreparedCluster[]): Promise<EditorialJudgment[]> {
  const date = new Date().toISOString().slice(0, 10);
  const clustersText = formatClustersForPrompt(prepared);

  const prompt = loadPrompt("news-editor", {
    date,
    cluster_count: String(prepared.length),
    clusters: clustersText,
  });

  const text = await callClaude(prompt, "claude-sonnet-4-6", { maxTurns: 1 });
  const parsed = JSON.parse(extractJson(text));

  // Validate it's an array of judgments
  if (!Array.isArray(parsed)) {
    throw new Error("Editor did not return an array of judgments");
  }

  return parsed as EditorialJudgment[];
}

// ---------------------------------------------------------------------------
// Phase 3: Code post-processing
// ---------------------------------------------------------------------------

function buildEditorialDecision(
  prepared: PreparedCluster[],
  judgments: EditorialJudgment[],
  totalRaw: number,
  dropCount: number,
): EditorialDecision {
  const date = new Date().toISOString().slice(0, 10);

  // Index judgments by cluster_id
  const judgmentMap = new Map<string, EditorialJudgment>();
  for (const j of judgments) judgmentMap.set(j.cluster_id, j);

  // Filter: keep included clusters
  const included: { prepared: PreparedCluster; judgment: EditorialJudgment }[] = [];
  for (const p of prepared) {
    const j = judgmentMap.get(p.cluster.id);
    if (j?.include) {
      included.push({ prepared: p, judgment: j });
    }
  }

  // Rank: must_tell > solid > filler, then source_breadth desc, tier_best asc
  const worthinessOrder = { must_tell: 0, solid: 1, filler: 2, skip: 3 };
  included.sort((a, b) => {
    const wDiff = worthinessOrder[a.judgment.newsworthiness] - worthinessOrder[b.judgment.newsworthiness];
    if (wDiff !== 0) return wDiff;
    if (b.prepared.signals.source_breadth !== a.prepared.signals.source_breadth)
      return b.prepared.signals.source_breadth - a.prepared.signals.source_breadth;
    return a.prepared.signals.tier_best - b.prepared.signals.tier_best;
  });

  // Source diversity: if >50% share a source type, demote lowest-ranked duplicates
  const sourceTypeCounts = new Map<string, number>();
  for (const { prepared: p } of included) {
    const st = sourceType(p.cluster.primary.source);
    sourceTypeCounts.set(st, (sourceTypeCounts.get(st) ?? 0) + 1);
  }
  const totalIncluded = included.length;
  if (totalIncluded > 2) {
    for (const [st, count] of sourceTypeCounts) {
      if (count / totalIncluded > 0.5) {
        // Demote: move excess items of this source type to the end
        const maxAllowed = Math.ceil(totalIncluded / 2);
        let seen = 0;
        for (let i = 0; i < included.length; i++) {
          if (sourceType(included[i].prepared.cluster.primary.source) === st) {
            seen++;
            if (seen > maxAllowed) {
              // Move to end
              const [item] = included.splice(i, 1);
              included.push(item);
              i--;
            }
          }
        }
      }
    }
  }

  // Cap at 10
  const capped = included.slice(0, 10);

  // Always publish — format adapts to story count
  const publishable = capped.length > 0;

  // Build CuratedStory[]
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

  const skippedCount = totalRaw - stories.length;

  const decision: EditorialDecision = {
    date,
    publishable,
    skip_reason: publishable ? null : capped.length === 0
      ? "No stories passed editorial judgment"
      : "All surviving stories are filler quality — not worth publishing",
    stories,
    total_raw: totalRaw,
    skipped_count: skippedCount,
    curated_at: new Date().toISOString(),
  };

  return decision;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * News Editor agent: curates raw news items into a publishable digest.
 *
 * Phase 1 (code): hard drops, event clustering, signal enrichment
 * Phase 2 (LLM): editorial judgment — is this news? what's the angle?
 * Phase 3 (code): rank, enforce diversity, determine publishability
 */
export async function editDigest(items: NewsItem[]): Promise<EditorialDecision> {
  console.log(`  [editor] starting with ${items.length} raw items…`);

  // Phase 1: Code pre-processing
  const { prepared, dropCount } = prepareForEditor(items);

  if (prepared.length === 0) {
    const date = new Date().toISOString().slice(0, 10);
    return {
      date,
      publishable: false,
      skip_reason: "No items survived hard filtering",
      stories: [],
      total_raw: items.length,
      skipped_count: items.length,
      curated_at: new Date().toISOString(),
    };
  }

  // Phase 2: LLM editorial judgment
  console.log(`  [editor] sending ${prepared.length} clusters for editorial judgment…`);
  const judgments = await getEditorialJudgments(prepared);
  console.log(`  [editor] received ${judgments.length} judgments`);

  const includedCount = judgments.filter((j) => j.include).length;
  console.log(`  [editor] LLM included ${includedCount} of ${judgments.length} clusters`);

  // Phase 3: Code post-processing
  const decision = buildEditorialDecision(prepared, judgments, items.length, dropCount);

  // Validate with Zod
  EditorialDecisionSchema.parse(decision);

  if (decision.publishable) {
    console.log(`  [editor] publishable: ${decision.stories.length} stories selected`);
    for (const story of decision.stories) {
      console.log(`    #${story.rank} [${story.significance}] ${story.title}`);
    }
  } else {
    console.log(`  [editor] skipping: ${decision.skip_reason}`);
  }

  return decision;
}
