import Parallel from "parallel-web";
import { requireKey } from "../config.js";

export interface AuthorityLink {
  url: string;
  title: string;
  domain: string;
  excerpts: string[];
}

let _client: Parallel | null = null;
function client(): Parallel {
  if (!_client) {
    _client = new Parallel({ apiKey: requireKey("parallelApiKey") });
  }
  return _client;
}

export async function searchAuthorityLinks(
  topic: string,
  angle: string,
): Promise<AuthorityLink[]> {
  try {
    const response = await client().beta.search({
      objective: `Find official documentation, specifications, authoritative technical guides, and research related to: ${topic}. Focus: ${angle}`,
      mode: "one-shot",
      max_results: 8,
      excerpts: { max_chars_per_result: 500 },
      source_policy: {
        exclude_domains: [
          "reddit.com",
          "news.ycombinator.com",
          "twitter.com",
          "x.com",
          "facebook.com",
          "medium.com",
          "dev.to",
          "codeongrass.com",
        ],
      },
    });

    return response.results
      .filter((r) => r.url && r.title)
      .map((r) => ({
        url: r.url,
        title: r.title!,
        domain: new URL(r.url).hostname,
        excerpts: r.excerpts ?? [],
      }));
  } catch (err) {
    console.warn("  [authority-search] search failed:", err);
    return [];
  }
}
