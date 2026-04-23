# ADR-008: Cross-run signal freshness and deduplication

## Status
Accepted

## Context
The pipeline is stateless — each run fetches the same 30-day window from Reddit/HN, producing largely identical signals across consecutive runs. This means the strategist repeatedly surfaces the same opportunities with no way to distinguish "we found this last week too" from "this just appeared." Without cross-run memory, every run looks like the first run.

## Decision
Introduce a persistent seen-URLs ledger (`data/seen-urls.json`) that tracks every signal URL across runs, and use it to classify signals as `new`, `resurfaced`, or `recurring` after LLM structuring.

Key design choices:
- **Freshness tagging is deterministic, not prompt-driven.** The LLM structuring step is unchanged — it still emits signals with `score`/`num_comments`. Classification happens post-LLM via delta comparison against the ledger. This keeps the tagging auditable and avoids prompt sensitivity.
- **Resurface thresholds are absolute-or-relative.** A signal resurfaces if score doubles (2x) or grows by +10, or if comments grow 1.5x or by +5. This prevents low-score signals from resurfacing on trivial changes while allowing high-engagement posts to trigger on percentage growth.
- **Signals without URLs default to `new`.** Demand signals from Frase have no URL — they're always treated as fresh since we can't track them across runs.
- **Ledger entries expire after 90 days** (pruned on load). This bounds storage and prevents ancient signals from permanently suppressing related new content.
- **Freshness flows through the full pipeline.** Analysis sees freshness on each signal and weights clustering. A `freshness_profile` (count of new/resurfaced/recurring signals) is attached to each opportunity post-LLM in the analysis step, giving the strategist a concrete scoring input rather than a vibes-based timeliness guess.

## Consequences
- Consecutive runs produce meaningfully different outputs — recurring signals are deprioritized, new signals drive new opportunities
- The strategist's `freshness` dimension is now grounded in data (signal-level freshness counts) rather than inferred from angle text
- Opportunities built only on `recurring` signals get lower confidence and are more likely to be dropped at the 25-point composite threshold
- First run behaves identically to the old pipeline (no ledger = all `new`)
- The ledger is a single shared JSON file — safe for in-process concurrency (JS single-threaded) but would need locking if multiple processes ran simultaneously
- A `resurfaced` signal acts as a natural alert for trending topics that were previously dormant
