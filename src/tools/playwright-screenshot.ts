/**
 * Playwright screenshot tool — captures browser screenshots of web pages
 * or specific elements. Used as the capture half of the hybrid
 * Parallel (identify) + Playwright (capture) visual resolution system.
 */

import { chromium } from "playwright-chromium";

export interface ScreenshotOptions {
  url: string;
  outputPath: string;
  selector?: string;
  scrollTo?: string;
}

export interface ScreenshotResult {
  ok: boolean;
  contentType: "image/png";
  ext: ".png";
  error?: string;
}

/** Best-effort cookie/consent popup dismissal. */
async function dismissPopups(page: import("playwright-chromium").Page): Promise<void> {
  const selectors = [
    '[class*="cookie"] button',
    '[id*="cookie"] button',
    '[class*="consent"] button',
    '[id*="consent"] button',
    'button[aria-label*="Accept"]',
    'button[aria-label*="accept"]',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 1000 });
        break;
      }
    } catch {
      // ignore
    }
  }
}

/**
 * For GitHub repo URLs without a specific selector, default to
 * `.markdown-body` to clip out the GitHub chrome (header, sidebar).
 */
function defaultSelector(url: string, selector?: string): string | undefined {
  if (selector) return selector;
  try {
    const u = new URL(url);
    if (u.hostname === "github.com") return ".markdown-body";
  } catch {}
  return undefined;
}

/**
 * Capture a screenshot of a URL (or a specific element on that page).
 *
 * - Viewport: 1280×800 at 2× DPR (crisp for retina / X feed)
 * - Forces light color scheme
 * - Falls back to viewport capture if selector not found
 */
export async function captureScreenshot(opts: ScreenshotOptions): Promise<ScreenshotResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    const page = await context.newPage();

    await page.goto(opts.url, { waitUntil: "networkidle", timeout: 15_000 });
    await dismissPopups(page);

    // Force light mode — some sites ignore colorScheme preference
    const bgColor = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const match = bg.match(/\d+/g);
      if (!match) return 255;
      return (parseInt(match[0]) + parseInt(match[1]) + parseInt(match[2])) / 3;
    });
    if (bgColor < 128) {
      await page.addStyleTag({
        content: `:root { color-scheme: light !important; }
          body, html { background-color: #fff !important; color: #111 !important; }
          pre, code { background-color: #f5f5f5 !important; color: #111 !important; }`,
      });
      await page.waitForTimeout(300);
    }

    const sel = defaultSelector(opts.url, opts.selector);

    // Scroll to anchor point if provided (used to disambiguate multiple matching elements)
    let scrolledToAnchor = false;
    if (opts.scrollTo) {
      try {
        await page.locator(opts.scrollTo).first().scrollIntoViewIfNeeded({ timeout: 3000 });
        await page.waitForTimeout(500);
        scrolledToAnchor = true;
      } catch {
        console.warn(`  [playwright] scrollTo selector not found: ${opts.scrollTo}`);
      }
    }

    // Find the element matching selector nearest to the current scroll position.
    // When scroll_to is used, this picks the right element among duplicates.
    async function findNearestLocator(selector: string): Promise<import("playwright-chromium").Locator> {
      if (!scrolledToAnchor) return page.locator(selector).first();
      // Get current scroll position, find the matching element closest to it
      const idx = await page.evaluate((s) => {
        const els = Array.from(document.querySelectorAll(s));
        if (els.length <= 1) return 0;
        const scrollY = window.scrollY + window.innerHeight / 2;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < els.length; i++) {
          const rect = els[i].getBoundingClientRect();
          const elY = window.scrollY + rect.top + rect.height / 2;
          const dist = Math.abs(elY - scrollY);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
        return bestIdx;
      }, selector).catch(() => 0);
      return page.locator(selector).nth(idx);
    }

    // Hide fixed/sticky elements (navbars, cookie banners) so they don't overlay the capture
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("*")) {
        const pos = getComputedStyle(el).position;
        if (pos === "fixed" || pos === "sticky") {
          (el as HTMLElement).style.display = "none";
        }
      }
    }).catch(() => {});
    await page.waitForTimeout(200);

    const MIN_WIDTH = 600;
    const MAX_HEIGHT = 1200;

    // Capture an element directly if it's a good size, or use it as a focal
    // point for a viewport screenshot if it's too narrow/tall.
    async function captureElement(
      loc: import("playwright-chromium").Locator,
      label: string,
    ): Promise<boolean> {
      try {
        await loc.waitFor({ state: "visible", timeout: 5000 });
        const box = await loc.boundingBox();
        if (box && box.width >= MIN_WIDTH && box.height <= MAX_HEIGHT) {
          await loc.screenshot({ path: opts.outputPath, timeout: 5000 });
          return true;
        }
        // Element exists but wrong size — take viewport as-is without repositioning.
        // Scrolling to center a tiny element produces a zoomed-in partial view;
        // keeping the current scroll position captures the surrounding context.
        const reason = box
          ? box.width < MIN_WIDTH ? `too narrow (${Math.round(box.width)}px)` : `too tall (${Math.round(box.height)}px)`
          : "no bounding box";
        console.warn(`  [playwright] "${label}" ${reason}, capturing viewport as-is`);
        await page.screenshot({ path: opts.outputPath, fullPage: false, timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }

    if (sel) {
      // Try the full selector first (nearest to scroll_to anchor if provided)
      const found = await captureElement(await findNearestLocator(sel), sel);

      if (!found) {
        // Compound selector failed — try each part individually (e.g. "main pre" → try "pre", then "main")
        const parts = sel.split(/\s+/).filter(Boolean);
        let recovered = false;
        if (parts.length > 1) {
          // Try parts in reverse order (most specific first)
          for (const part of parts.reverse()) {
            console.warn(`  [playwright] trying partial selector "${part}"`);
            recovered = await captureElement(await findNearestLocator(part), part);
            if (recovered) break;
          }
        }
        if (!recovered && opts.scrollTo) {
          // Last resort: use scroll_to as focal point
          console.warn(`  [playwright] trying scrollTo "${opts.scrollTo}" as focal point`);
          recovered = await captureElement(page.locator(opts.scrollTo).first(), opts.scrollTo);
        }
        if (!recovered) {
          console.warn(`  [playwright] all selectors failed, falling back to viewport`);
          await page.screenshot({ path: opts.outputPath, fullPage: false, timeout: 5000 });
        }
      }
    } else {
      await page.screenshot({ path: opts.outputPath, fullPage: false, timeout: 5000 });
    }

    return { ok: true, contentType: "image/png", ext: ".png" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, contentType: "image/png", ext: ".png", error: msg };
  } finally {
    await browser.close();
  }
}
