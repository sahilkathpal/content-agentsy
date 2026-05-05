import { extractJson } from "../claude.js";
import { runAgent } from "./runner.js";
import { editorialMcpServer } from "../tools/editorial-tools.js";
import { EditorialDecisionSchema, type EditorialDecision, type NewsItem } from "../models/digest.js";

/**
 * News Editor agent: curates raw news items into a publishable digest.
 *
 * Claude orchestrates the full editorial pipeline via tool calls:
 *   1. Claude calls prepare_clusters (hard-drops, clustering, enrichment)
 *   2. Claude evaluates each cluster editorially (its own reasoning)
 *   3. Claude calls finalize_stories (ranking, diversity, publishability)
 *   4. Claude returns the EditorialDecision JSON
 */
export async function editDigest(items: NewsItem[]): Promise<EditorialDecision> {
  console.log(`  [editor] starting agent with ${items.length} raw items…`);

  if (items.length === 0) {
    const date = new Date().toISOString().slice(0, 10);
    return {
      date,
      publishable: false,
      skip_reason: "No items from researcher",
      stories: [],
      total_raw: 0,
      skipped_count: 0,
      curated_at: new Date().toISOString(),
    };
  }

  const date = new Date().toISOString().slice(0, 10);
  const prompt = `Today: ${date}\n\nRaw items (${items.length}):\n${JSON.stringify(items, null, 2)}`;

  const text = await runAgent({
    agentId: "editor",
    prompt,
    mcpServer: editorialMcpServer,
  });

  const parsed = JSON.parse(extractJson(text));
  const decision = EditorialDecisionSchema.parse(parsed);

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
