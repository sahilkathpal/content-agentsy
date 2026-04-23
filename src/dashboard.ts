import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SiteScorecard } from "./models/site-scorecard.js";

const SCORECARD_PATH = resolve(new URL(".", import.meta.url).pathname, "../data/scorecard.json");
const PORT = Number(process.env.DASHBOARD_PORT ?? 3333);

function loadScorecard(): SiteScorecard | null {
  if (!existsSync(SCORECARD_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SCORECARD_PATH, "utf-8")) as SiteScorecard;
  } catch {
    return null;
  }
}

function freshnessColor(dateStr: string | null): string {
  if (!dateStr) return "#9ca3af";
  const today = new Date().toISOString().slice(0, 10);
  return dateStr >= today ? "#16a34a" : "#d97706";
}

function bar(pct: number, color: string): string {
  const w = Math.min(100, Math.max(0, pct));
  return `<div style="background:#e5e5e3;border-radius:4px;height:10px;width:100%"><div style="background:${color};height:10px;border-radius:4px;width:${w}%"></div></div>`;
}

function slugFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "");
    return p.split("/").filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

function quadrantColor(q: string): string {
  switch (q) {
    case "star":     return "#16a34a";
    case "geo_only": return "#2563eb";
    case "seo_only": return "#9333ea";
    default:         return "#9ca3af";
  }
}

function quadrantLabel(q: string): string {
  switch (q) {
    case "star":     return "Star";
    case "geo_only": return "GEO Only";
    case "seo_only": return "SEO Only";
    default:         return "Orphan";
  }
}

function renderHtml(sc: SiteScorecard): string {
  const { outcome, seo, bridge, metadata } = sc;
  const loadedAt = new Date().toLocaleTimeString();
  const scoredAt = new Date(sc.scored_at).toLocaleString();

  // Data freshness
  const otterlyDate = metadata.data_freshness.otterly_last_sync ?? "—";
  const gscDate     = metadata.data_freshness.gsc_last_sync ?? "—";
  const otterlyCol  = freshnessColor(metadata.data_freshness.otterly_last_sync);
  const gscCol      = freshnessColor(metadata.data_freshness.gsc_last_sync);

  // Threshold pill
  const breaches = metadata.thresholds_breached.length;
  const thresholdPill = breaches === 0
    ? `<span style="background:#dcfce7;color:#16a34a;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600">All Clear</span>`
    : `<span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600">${breaches} Breach${breaches > 1 ? "es" : ""}</span>`;

  // Citations by engine — sorted descending
  const engineEntries = Object.entries(outcome.domain_citations_by_engine)
    .sort((a, b) => b[1] - a[1]);
  const maxCitations = Math.max(...engineEntries.map(e => e[1]), 1);
  const sovByEngine = outcome.position_weighted_sov_by_engine;

  const engineRows = engineEntries.map(([engine, count]) => {
    const sov = sovByEngine[engine] ?? 0;
    const pct = (count / maxCitations) * 100;
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
          <span style="text-transform:capitalize;font-weight:500">${engine}</span>
          <span style="color:#6b7280">${count} citations &middot; ${sov.toFixed(1)}% SOV</span>
        </div>
        ${bar(pct, "#2563eb")}
      </div>`;
  }).join("");

  // Top queries
  const topQueries = (seo.top_queries ?? []).slice(0, 15);
  const topQueryRows = topQueries.length === 0
    ? `<tr><td colspan="6" style="color:#9ca3af;text-align:center;padding:12px">No data</td></tr>`
    : topQueries.map(q => {
        const badge = q.is_branded
          ? `<span style="background:#dbeafe;color:#2563eb;border-radius:999px;padding:1px 7px;font-size:11px;font-weight:600">brand</span>`
          : `<span style="background:#f3f4f6;color:#6b7280;border-radius:999px;padding:1px 7px;font-size:11px;font-weight:600">organic</span>`;
        return `<tr>
          <td style="padding:6px 4px;font-size:12px;color:#374151">${q.query}</td>
          <td style="padding:6px 4px;text-align:right;font-weight:600">${q.impressions_7d}</td>
          <td style="padding:6px 4px;text-align:right">${q.clicks_7d}</td>
          <td style="padding:6px 4px;text-align:right;color:#6b7280">${(q.ctr * 100).toFixed(1)}%</td>
          <td style="padding:6px 4px;text-align:right;color:#6b7280">${q.position.toFixed(1)}</td>
          <td style="padding:6px 4px;text-align:right">${badge}</td>
        </tr>`;
      }).join("");

  // Top pages
  const topPages = (seo.top_pages_by_clicks ?? []).slice(0, 5);
  const topPagesRows = topPages.length === 0
    ? `<tr><td colspan="4" style="color:#9ca3af;text-align:center;padding:12px">No data</td></tr>`
    : topPages.map(p => {
        const ctr = p.impressions > 0 ? ((p.clicks / p.impressions) * 100).toFixed(1) : "0.0";
        return `<tr>
          <td style="padding:6px 4px;font-size:12px;color:#374151;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${slugFromUrl(p.url)}</td>
          <td style="padding:6px 4px;text-align:right;font-size:13px;font-weight:600">${p.clicks}</td>
          <td style="padding:6px 4px;text-align:right;font-size:12px;color:#6b7280">${p.impressions}</td>
          <td style="padding:6px 4px;text-align:right;font-size:12px;color:#6b7280">${ctr}%</td>
        </tr>`;
      }).join("");

  // Quadrant map
  const quadrants: Array<"star" | "geo_only" | "seo_only" | "orphan"> = ["star", "geo_only", "seo_only", "orphan"];
  const articles = bridge.geo_seo_quadrant_per_article ?? [];
  const quadrantCols = quadrants.map(q => {
    const col = quadrantColor(q);
    const items = articles.filter(a => a.quadrant === q);
    const cards = items.length === 0
      ? `<div style="font-size:12px;color:#9ca3af">none</div>`
      : items.map(a => {
          const badge = q === "star" || q === "geo_only"
            ? `<span style="background:${col}22;color:${col};border-radius:999px;padding:1px 7px;font-size:11px;font-weight:600">${a.citations_7d}c</span>`
            : `<span style="background:${col}22;color:${col};border-radius:999px;padding:1px 7px;font-size:11px;font-weight:600">${a.gsc_clicks_7d}clk</span>`;
          return `<div style="background:#f9f9f8;border:1px solid #e5e5e3;border-radius:6px;padding:6px 8px;margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:4px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151">${a.slug}</span>
            ${badge}
          </div>`;
        }).join("");
    return `<div style="background:#fff;border:1px solid #e5e5e3;border-radius:8px;padding:14px">
      <div style="font-weight:700;font-size:13px;color:${col};margin-bottom:10px;border-bottom:2px solid ${col};padding-bottom:6px">${quadrantLabel(q)} <span style="font-weight:400;color:#6b7280">(${items.length})</span></div>
      ${cards}
    </div>`;
  }).join("");

  // Competitor context
  const competitors = outcome.top_competitors_by_citations ?? [];
  const domain = sc.domain;
  const maxComp = Math.max(...competitors.map(c => c.citations_7d), outcome.domain_citations_total_7d, 1);
  const domainRow = `<tr style="background:#fef3c7">
    <td style="padding:7px 8px;font-weight:700;font-size:13px">${domain}</td>
    <td style="padding:7px 8px">${bar((outcome.domain_citations_total_7d / maxComp) * 100, "#d97706")}</td>
    <td style="padding:7px 8px;text-align:right;font-weight:700">${outcome.domain_citations_total_7d}</td>
  </tr>`;
  const competitorRows = competitors.slice(0, 5).map(c => `<tr>
    <td style="padding:7px 8px;font-size:13px;color:#374151">${c.name}</td>
    <td style="padding:7px 8px">${bar((c.citations_7d / maxComp) * 100, "#6b7280")}</td>
    <td style="padding:7px 8px;text-align:right;font-size:13px">${c.citations_7d}</td>
  </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scorecard — ${domain}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9f9f8;color:#111;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:24px 20px}
h2{font-size:15px;font-weight:700;color:#111;margin-bottom:14px}
.card{background:#fff;border:1px solid #e5e5e3;border-radius:8px;padding:18px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:12px;color:#6b7280;font-weight:600;padding:4px 4px 8px;border-bottom:1px solid #e5e5e3}
</style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:24px">
    <div>
      <div style="font-size:22px;font-weight:800;color:#111">${domain}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:2px">Scored at ${scoredAt}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="background:${otterlyCol}22;color:${otterlyCol};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600">Otterly: ${otterlyDate}</span>
      <span style="background:${gscCol}22;color:${gscCol};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600">GSC: ${gscDate}</span>
      ${thresholdPill}
    </div>
  </div>

  <!-- Hero Metrics -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
    ${[
      ["Total Citations", outcome.domain_citations_total_7d.toString()],
      ["Brand Mentions", outcome.brand_mentions_7d.toString()],
      ["Coverage %", `${outcome.citation_coverage_pct.toFixed(2)}%<div style="font-size:12px;color:#6b7280;font-weight:400;margin-top:2px">${outcome.prompts_where_cited}/${outcome.prompts_tracked} prompts</div>`],
      ["Avg SOV %", `${outcome.position_weighted_sov_total.toFixed(2)}%`],
      ["SEO Clicks", seo.site_clicks_7d.toString()],
    ].map(([label, value]) => `
      <div class="card">
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px">${label}</div>
        <div style="font-size:28px;font-weight:800;color:#111;line-height:1.1">${value}</div>
      </div>`).join("")}
  </div>

  <!-- Two-column row -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
    <div class="card">
      <h2>Citations by Engine</h2>
      ${engineRows || '<div style="color:#9ca3af;font-size:13px">No data</div>'}
    </div>
    <div class="card">
      <h2>Top Pages by Clicks</h2>
      <table>
        <thead><tr>
          <th>Page</th><th style="text-align:right">Clicks</th>
          <th style="text-align:right">Impr</th><th style="text-align:right">CTR</th>
        </tr></thead>
        <tbody>${topPagesRows}</tbody>
      </table>
    </div>
  </div>

  <!-- Top Queries -->
  <div class="card" style="margin-bottom:20px">
    <h2>Top Queries (7d)</h2>
    <table>
      <thead><tr>
        <th>Query</th>
        <th style="text-align:right">Impressions</th>
        <th style="text-align:right">Clicks</th>
        <th style="text-align:right">CTR</th>
        <th style="text-align:right">Position</th>
        <th style="text-align:right">Type</th>
      </tr></thead>
      <tbody>${topQueryRows}</tbody>
    </table>
  </div>

  <!-- Article Quadrant Map -->
  <div style="margin-bottom:20px">
    <h2 style="margin-bottom:12px">Article Quadrant Map</h2>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${quadrantCols}
    </div>
  </div>

  <!-- Competitor Context -->
  <div class="card" style="margin-bottom:20px">
    <h2>Competitor Context (7d Citations)</h2>
    <table>
      <thead><tr><th>Domain</th><th>Bar</th><th style="text-align:right">Citations</th></tr></thead>
      <tbody>
        ${domainRow}
        ${competitorRows}
      </tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="text-align:center;font-size:12px;color:#9ca3af;padding:8px 0">
    Loaded at ${loadedAt} &middot; <a href="/api/scorecard" style="color:#6b7280">raw JSON</a>
  </div>

</div>
<script>setTimeout(() => location.reload(), 30000)</script>
</body>
</html>`;
}

function renderError(msg: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;color:#dc2626">
    <h1>Dashboard Error</h1><p>${msg}</p>
  </body></html>`;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";

  if (url === "/api/scorecard") {
    const sc = loadScorecard();
    if (!sc) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "scorecard.json not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sc, null, 2));
    return;
  }

  if (url === "/" || url === "") {
    const sc = loadScorecard();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (!sc) {
      res.end(renderError(`data/scorecard.json not found at ${SCORECARD_PATH}. Run <code>npm run scorecard</code> first.`));
      return;
    }
    res.end(renderHtml(sc));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

const server = createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderError(String(err)));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[dashboard] http://localhost:${PORT}`);
});
