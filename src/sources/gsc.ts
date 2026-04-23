import { config } from "../config.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";

// ── Types ───────────────────────────────────────────────��────────────

export interface GscPageMetrics {
  impressions: number;
  clicks: number;
  ctr: number; // 0-1
  positions: Record<string, number>; // keyword → avg position
}

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscResponse {
  rows?: GscRow[];
  responseAggregationType?: string;
}

// ── Auth ─────────────────────────────────────────────────────────────

let cachedToken: { access_token: string; expires_at: number } | null = null;

function getGscConfig() {
  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  const refreshToken = process.env.GSC_REFRESH_TOKEN;
  const siteUrl = process.env.GSC_SITE_URL; // e.g. "https://codeongrass.com" or "sc-domain:codeongrass.com"

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return { clientId, clientSecret, refreshToken, siteUrl: siteUrl ?? "" };
}

async function getAccessToken(): Promise<string | null> {
  const cfg = getGscConfig();
  if (!cfg) return null;

  // Reuse cached token if still valid (5 min buffer)
  if (cachedToken && Date.now() < cachedToken.expires_at - 300_000) {
    return cachedToken.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    console.warn(`[gsc] Token refresh failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.access_token;
}

// ── API ──────────────────────────────────────────────────────────────

/**
 * Query GSC Search Analytics for a specific page URL.
 * Returns per-keyword impressions, clicks, CTR, and position.
 */
export async function getPageMetrics(
  pageUrl: string,
  window: "7d" | "14d" | "30d" | "90d" = "7d",
): Promise<GscPageMetrics> {
  const zeros: GscPageMetrics = { impressions: 0, clicks: 0, ctr: 0, positions: {} };

  const cfg = getGscConfig();
  if (!cfg || !cfg.siteUrl) {
    return zeros;
  }

  const token = await getAccessToken();
  if (!token) return zeros;

  const days = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }[window];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  // GSC data has a ~3 day lag
  endDate.setDate(endDate.getDate() - 3);
  if (startDate >= endDate) {
    startDate.setDate(endDate.getDate() - days);
  }

  const siteUrlEncoded = encodeURIComponent(cfg.siteUrl);

  try {
    const res = await fetch(
      `${GSC_BASE}/sites/${siteUrlEncoded}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
          dimensions: ["query"],
          dimensionFilterGroups: [
            {
              filters: [
                {
                  dimension: "page",
                  operator: "equals",
                  expression: pageUrl,
                },
              ],
            },
          ],
          rowLimit: 100,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      console.warn(`[gsc] Search Analytics query failed: ${res.status}`);
      return zeros;
    }

    const data = (await res.json()) as GscResponse;
    if (!data.rows || data.rows.length === 0) return zeros;

    let totalImpressions = 0;
    let totalClicks = 0;
    const positions: Record<string, number> = {};

    for (const row of data.rows) {
      const keyword = row.keys[0];
      totalImpressions += row.impressions;
      totalClicks += row.clicks;
      positions[keyword] = Math.round(row.position * 10) / 10;
    }

    const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

    return {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: Math.round(ctr * 10000) / 100, // percentage with 2 decimals
      positions,
    };
  } catch (err) {
    console.warn(`[gsc] Query failed for "${pageUrl}":`, err);
    return zeros;
  }
}

/**
 * Check if GSC is configured and credentials are valid.
 */
export async function isGscAvailable(): Promise<boolean> {
  const cfg = getGscConfig();
  if (!cfg || !cfg.siteUrl) return false;

  const token = await getAccessToken();
  return token !== null;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Site-level metrics ──────────────────────────────────────────────

export interface GscSiteMetrics {
  impressions: number;
  clicks: number;
  ctr: number;
}

/**
 * Query GSC Search Analytics at the site level (no page filter, no dimensions).
 * Returns aggregate impressions, clicks, CTR for the window.
 */
export async function getSiteMetrics(
  window: "7d" = "7d",
): Promise<GscSiteMetrics> {
  const zeros: GscSiteMetrics = { impressions: 0, clicks: 0, ctr: 0 };
  const cfg = getGscConfig();
  if (!cfg || !cfg.siteUrl) return zeros;

  const token = await getAccessToken();
  if (!token) return zeros;

  const days = { "7d": 7 }[window];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  endDate.setDate(endDate.getDate() - 3);
  if (startDate >= endDate) startDate.setDate(endDate.getDate() - days);

  const siteUrlEncoded = encodeURIComponent(cfg.siteUrl);

  try {
    const res = await fetch(
      `${GSC_BASE}/sites/${siteUrlEncoded}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
          rowLimit: 1,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      console.warn(`[gsc] Site metrics query failed: ${res.status}`);
      return zeros;
    }

    const data = (await res.json()) as GscResponse;
    if (!data.rows || data.rows.length === 0) return zeros;

    const row = data.rows[0];
    return {
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: Math.round(row.ctr * 10000) / 100,
    };
  } catch (err) {
    console.warn(`[gsc] Site metrics query failed:`, err);
    return zeros;
  }
}

// ── Query-level metrics ─────────────────────────────────────────────

export interface GscQueryRow {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

/**
 * Query GSC with dimensions: ["query"]. Returns per-query metrics.
 */
export async function getQueryMetrics(
  window: "7d" | "28d",
  rowLimit: number = 500,
): Promise<GscQueryRow[]> {
  const cfg = getGscConfig();
  if (!cfg || !cfg.siteUrl) return [];

  const token = await getAccessToken();
  if (!token) return [];

  const days = { "7d": 7, "28d": 28 }[window];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  endDate.setDate(endDate.getDate() - 3);
  if (startDate >= endDate) startDate.setDate(endDate.getDate() - days);

  const siteUrlEncoded = encodeURIComponent(cfg.siteUrl);

  try {
    const res = await fetch(
      `${GSC_BASE}/sites/${siteUrlEncoded}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
          dimensions: ["query"],
          rowLimit,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      console.warn(`[gsc] Query metrics failed: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as GscResponse;
    if (!data.rows) return [];

    return data.rows.map((row) => ({
      query: row.keys[0],
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: Math.round(row.ctr * 10000) / 100,
      position: Math.round(row.position * 10) / 10,
    }));
  } catch (err) {
    console.warn(`[gsc] Query metrics failed:`, err);
    return [];
  }
}

// ── Page list ───────────────────────────────────────────────────────

export interface GscPageRow {
  url: string;
  impressions: number;
  clicks: number;
}

/**
 * Query GSC with dimensions: ["page"], no page filter. Returns all pages with traffic.
 */
export async function getPageList(
  window: "7d" = "7d",
): Promise<GscPageRow[]> {
  const cfg = getGscConfig();
  if (!cfg || !cfg.siteUrl) return [];

  const token = await getAccessToken();
  if (!token) return [];

  const days = { "7d": 7 }[window];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  endDate.setDate(endDate.getDate() - 3);
  if (startDate >= endDate) startDate.setDate(endDate.getDate() - days);

  const siteUrlEncoded = encodeURIComponent(cfg.siteUrl);

  try {
    const res = await fetch(
      `${GSC_BASE}/sites/${siteUrlEncoded}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
          dimensions: ["page"],
          rowLimit: 1000,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      console.warn(`[gsc] Page list query failed: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as GscResponse;
    if (!data.rows) return [];

    return data.rows.map((row) => ({
      url: row.keys[0],
      impressions: row.impressions,
      clicks: row.clicks,
    }));
  } catch (err) {
    console.warn(`[gsc] Page list query failed:`, err);
    return [];
  }
}
