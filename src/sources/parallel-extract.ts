import Parallel from "parallel-web";
import { requireKey } from "../config.js";

export interface ExtractResult {
  url: string;
  title: string | undefined;
  publish_date: string | undefined;
  excerpts: string[];
}

let _client: Parallel | null = null;
export function client(): Parallel {
  if (!_client) {
    _client = new Parallel({ apiKey: requireKey("parallelApiKey") });
  }
  return _client;
}

export async function extractUrls(
  urls: string[],
  objective?: string
): Promise<ExtractResult[]> {
  if (urls.length === 0) return [];

  try {
    const response = await client().beta.extract({
      urls,
      objective: objective ?? null,
      excerpts: true,
    });

    return response.results.map((r) => ({
      url: r.url,
      title: r.title ?? undefined,
      publish_date: r.publish_date ?? undefined,
      excerpts: r.excerpts ?? [],
    }));
  } catch (err) {
    console.warn(`Parallel extract failed for ${urls.length} URLs:`, err);
    return [];
  }
}
