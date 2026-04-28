/**
 * Find the best visual asset for a story using Parallel's Task API.
 *
 * Parallel browses the page, reads the README/article, evaluates all images,
 * and returns the best one — not just the first image or a logo.
 */

import { client } from "../sources/parallel-extract.js";
import type { VisualHint } from "../models/digest.js";

export interface VisualResultDownload {
  resolution: "download";
  image_url: string;
  image_type: "demo_gif" | "screenshot" | "diagram" | "banner" | "chart";
  description: string;
}

export interface VisualResultScreenshot {
  resolution: "screenshot";
  page_url: string;
  selector?: string;
  scroll_to?: string;
  image_type: "screenshot" | "diagram" | "banner" | "chart";
  description: string;
}

export type VisualResult = VisualResultDownload | VisualResultScreenshot;

const CANDIDATE_SCHEMA = {
  type: "object" as const,
  properties: {
    resolution: {
      type: "string",
      enum: ["download", "screenshot"],
      description:
        "How to resolve: 'download' if a direct image URL exists, 'screenshot' if visual content must be captured via browser screenshot",
    },
    image_url: {
      type: "string",
      description:
        "Direct URL to the image file (only when resolution=download). Must end in .png, .gif, .jpg, .jpeg, .webp, or be a raw GitHub/CDN URL that serves an image.",
    },
    page_url: {
      type: "string",
      description:
        "URL of the page to screenshot (only when resolution=screenshot). May differ from the browsed URL if you followed a link.",
    },
    selector: {
      type: "string",
      description:
        "CSS selector for the visual element to capture (only when resolution=screenshot). Target the element type (e.g. pre, table, canvas, img). When multiple matching elements exist on the page, use scroll_to to disambiguate. The screenshot will be framed around this element. Omit for full viewport capture.",
    },
    scroll_to: {
      type: "string",
      description:
        "CSS selector to scroll into view BEFORE finding the capture target (only when resolution=screenshot). IMPORTANT: Use this to disambiguate when there are multiple elements matching the selector — e.g. if the page has 7 pre blocks and you want the one under 'Example Output', set scroll_to to the heading anchor (#example-output) or a nearby unique element. The screenshot will capture the first element matching selector that is visible near this scroll point.",
    },
    image_type: {
      type: "string",
      enum: ["demo_gif", "screenshot", "diagram", "banner", "chart"],
      description:
        "Type of visual",
    },
    description: {
      type: "string",
      description: "Brief description of what the image shows",
    },
  },
  required: ["resolution", "image_type", "description"],
};

const OUTPUT_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: CANDIDATE_SCHEMA,
        description:
          "Up to 3 visual candidates, ranked by relevance. Include diverse options (e.g. a downloadable image AND a screenshot target). Empty array if nothing suitable found.",
      },
    },
    required: ["candidates"],
  },
};

// ---------------------------------------------------------------------------
// Type-aware prompt templates
// ---------------------------------------------------------------------------

const TYPE_PROMPTS: Record<VisualHint["image_type"], string> = {
  screenshot: `Find a product screenshot or UI capture showing "{description}".
Prioritize clean interface shots that show the actual tool in action.
Do NOT return hero banners, marketing graphics, or generic website headers.

EXPLORE THE SITE: Check linked subpages (e.g. /features, /demo, /docs, /examples) for product
screenshots, CLI output demos, or example results. Compare what you find on subpages against the
homepage — return whichever is the stronger visual. A homepage is a good candidate when it shows
the product UI, an interactive demo, or embedded screenshots — not when it's just marketing copy.

If the best visual is not a downloadable image file (rendered UI, interactive widget, styled HTML,
terminal/CLI output rendered on the page), set resolution="screenshot" and provide the page_url
and a CSS selector targeting that element.`,

  demo_gif: `Find an animated GIF demonstrating "{description}".
Must be a real demo showing the tool in use, not a static image or loading spinner.
GIF must be under 15MB. If no GIF exists, a high-quality screenshot is acceptable.`,

  diagram: `Find an architecture diagram, system diagram, or technical illustration showing "{description}".
Do NOT return marketing infographics or decorative graphics.

VISUAL QUALITY PRIORITY: If the current page has a styled, visually polished rendering of the diagram
(CSS-styled boxes, animated connections, colored elements), ALWAYS prefer screenshotting that over
following links to find an ASCII or text-based version in docs/README. A styled homepage diagram is
far more engaging than a monospace ASCII version of the same information.

If the best visual is not a downloadable image file (styled HTML elements, CSS-rendered diagrams,
ASCII art in <pre> blocks, Mermaid charts, HTML tables), set resolution="screenshot" and provide
the page_url and a CSS selector targeting that element. Use the URL of the page you're currently on,
not a different page you navigated away from, unless the current page truly has nothing relevant.`,

  chart: `Find a benchmark chart, comparison table image, or data visualization showing "{description}".
Must contain real data — not decorative graphics or placeholder charts.
Prioritize charts that appear in the project README, blog post body, or documentation.

If the chart or table is rendered as HTML (not an image file), set resolution="screenshot" and
provide the page_url and a CSS selector targeting that element.`,

  banner: `Find a banner or cover image for "{product_name}".
Should be a designed social/cover image that represents the project visually.
Do NOT return generic platform OG cards.`,
};

function sharedRules(productName: string): string {
  return `
CRITICAL RULES:
- The image MUST directly depict the tool, feature, or concept described. A generic or unrelated image is WORSE than no image.
- If you cannot find a relevant, high-quality image — return an empty string for image_url. Do NOT force a result.
- Do NOT return SVG files — they won't render on the target platform.
- Do NOT return YouTube video thumbnails — they are creator-designed clickbait, not product visuals.
- Do NOT return og:image tags from Reddit, Twitter, or Hacker News — these are generic platform cards.

AVOID returning any of these:
- Project logos or wordmarks (small square/rectangular brand images)
- Small icons or favicons
- Badges (shields.io, CI status, star count, license, version badges)
- Tracking pixels or 1x1 images
- Sponsor or partner logos
- Star history charts (starchart.cc, star-history.com)
- Images from a DIFFERENT project than "${productName}"

SCREENSHOT QUALITY RULES:
- Screenshots MUST be captured at a wide desktop viewport (1280px+). Narrow mobile-width captures are unusable.
- Do NOT screenshot pages where navigation bars, cookie banners, or site chrome will bisect the target content.
- CSS selectors should target the specific visual element (the pre block, the chart, the diagram). The downstream screenshot tool will frame the capture around it automatically.

SOURCE-SPECIFIC INSTRUCTIONS:
- Reddit/Hacker News: Follow the main outbound link to find the actual project. Source visuals from that project, NOT from the Reddit/HN page itself.
- arXiv papers: Look for a companion GitHub repository linked in the paper. If no companion repo exists, return empty — paper abstracts are not good visuals.
- Blog posts: Find screenshots or diagrams within the article body, not the blog's header/hero image.

RESOLUTION RULES:
- If a suitable downloadable image file exists: set resolution="download" and provide image_url.
- If visual content exists but is NOT an image file (CSS-styled diagrams, interactive widgets,
  rendered UI, ASCII art in <pre> blocks, Mermaid charts, HTML tables): set resolution="screenshot",
  provide page_url (the URL where this content is visible), and optionally a CSS selector.
  Only use this when the content is genuinely visual — plain text paragraphs are NOT worth screenshotting.
- If nothing suitable exists: set resolution="none".

IMPORTANT: When choosing between a styled/polished visual on the current page and a simpler version
on a linked page (e.g. ASCII art in docs vs. a CSS-rendered diagram on the homepage), ALWAYS prefer
the more visually polished version. These images will appear in social media feeds — visual quality matters.

For downloadable images, return the direct URL to the image file. For GitHub-hosted images, return the raw.githubusercontent.com URL.`;
}

/**
 * Use Parallel's Task API to find visual candidates for a story.
 *
 * The agent browses the URL, reads the README or article, evaluates
 * all images, and returns up to 3 candidates ranked by relevance.
 */
export async function findVisualCandidates(
  url: string,
  hint: VisualHint,
): Promise<VisualResult[]> {
  const typePrompt = TYPE_PROMPTS[hint.image_type]
    .replace(/\{description\}/g, hint.description)
    .replace(/\{product_name\}/g, hint.product_name);

  const rules = sharedRules(hint.product_name);

  const input = `Browse this page and find visual assets for: ${url}

Product: "${hint.product_name}"

${typePrompt}
${rules}

Return up to 3 candidates, ranked by relevance. Include diverse options — e.g. a downloadable image
AND a screenshot target if both exist. Prefer visual quality over quantity — 1 great candidate beats
3 mediocre ones. Return an empty candidates array if nothing suitable exists.`;

  try {
    const run = await client().taskRun.create({
      input,
      processor: "base",
      task_spec: { output_schema: OUTPUT_SCHEMA },
    });

    // Poll with retry — 408 means the run is still active, not failed
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await client().taskRun.result(run.run_id, { timeout: 90 });
        break;
      } catch (pollErr) {
        const is408 = pollErr instanceof Error && pollErr.message.includes("408");
        if (is408 && attempt === 0) {
          console.warn("  [parallel-visual] Run still active, retrying...");
          continue;
        }
        throw pollErr;
      }
    }

    if (!result || result.output.type !== "json") {
      console.warn("  [parallel-visual] Unexpected or missing output");
      return [];
    }

    const content = result.output.content as Record<string, unknown>;
    const rawCandidates = content.candidates as Record<string, unknown>[];
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
      console.warn("  [parallel-visual] No candidates returned");
      return [];
    }

    const results: VisualResult[] = [];
    for (const c of rawCandidates) {
      const resolution = c.resolution as string;
      const imageType = c.image_type as VisualResultDownload["image_type"];
      const description = (c.description as string) ?? "";

      if (resolution === "download") {
        const imageUrl = c.image_url as string;
        if (!imageUrl || imageUrl.length < 10) continue;
        results.push({ resolution: "download", image_url: imageUrl, image_type: imageType, description });
      } else if (resolution === "screenshot") {
        const pageUrl = c.page_url as string;
        if (!pageUrl || pageUrl.length < 10) continue;
        results.push({
          resolution: "screenshot",
          page_url: pageUrl,
          selector: (c.selector as string) || undefined,
          scroll_to: (c.scroll_to as string) || undefined,
          image_type: imageType as VisualResultScreenshot["image_type"],
          description,
        });
      }
    }

    console.log(`  [parallel-visual] ${results.length} candidate(s) from ${url}`);
    return results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [parallel-visual] Task failed for ${url}: ${msg}`);
    return [];
  }
}
