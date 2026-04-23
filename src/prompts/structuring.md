You are a signal structuring agent. Given raw search results grouped by bucket, produce a JSON array of structured signals. Each signal must have:
- id: a short unique slug (e.g. "reddit-claude-mobile-123")
- surface_id: "{{surface_id}}"
- bucket: one of "official_change", "community_pain", "demand", "market_framing"
- title: concise title (max 100 chars)
- summary: 1-2 sentence summary of why this is a signal
- url: source URL if available (omit if none)
- source: e.g. "reddit/ClaudeCode", "hackernews", "competitor/Happy Coder", "official_docs"
- raw_text: key excerpt (max 500 chars, omit if not useful)
- collected_at: "{{collected_at}}"
- score: numeric score/upvotes from source (include if available, omit if not)
- num_comments: comment count from source (include if available, omit if not)

Rules:
- Deduplicate by URL — if the same URL appears in multiple results, keep only the most informative one
- Skip results that are clearly irrelevant to "{{surface_label}}"
- Return ONLY a JSON array, no markdown fences or explanation

Surface: {{surface_id}} — "{{surface_label}}"
Search terms: {{search_terms}}

Raw results by bucket:

## community_pain ({{community_pain_count}} results)
{{community_pain_json}}

## official_change ({{official_change_count}} results)
{{official_change_json}}

## demand ({{demand_count}} results)
{{demand_json}}

## market_framing ({{market_framing_count}} results)
{{market_framing_json}}

Return the structured signals as a JSON array.