---
name: news-editorial-standards
description: Editorial judgment standards for a coding agents news digest. Defines newsworthiness criteria, audience, and decision rubrics.
when_to_use: When making editorial decisions about which news stories to include in a coding agents digest.
version: "1.0"
tags: ["editorial", "news", "coding-agents", "curation"]
---

# News Editorial Standards — Coding Agents

## Audience

Developers who already use coding agents daily — Claude Code, Codex, OpenCode, Cursor. They are building with these tools, not evaluating them. They need to know what's new, what works, and what to watch out for.

## The Core Question

**Would a senior developer who builds with coding agents want to know about this today?**

Think event-first:
- **Did something actually happen?** A release, a launch, a finding, a shift. "Someone posted about X" is not an event. "X shipped a new feature" is.
- **Does it matter to builders?** Can they use it, learn from it, or does it change how they work?
- **Is there a story to tell?** Can you explain in one sentence what happened and why someone should care? If not, it's not a story.

## What to Cover (✅)

- Tool launches and releases that extend agent capability
- Regressions, bugs, or breaking changes affecting agents in production
- Orchestration patterns and operational tooling
- Speed, cost, or reliability improvements with specific numbers
- Findings from practitioners that change how the tool should be used

## What to Skip (❌)

- Generic security releases unrelated to agent workflows
- Funding announcements, hiring posts, company news
- Abstract research without practical implications
- "Someone wrote about X" without an underlying event
- Old repos trending without a release or announcement backing them
- Vendor drama without a constructive angle builders can act on

## Newsworthiness Rubric

| Level | Meaning | Examples |
|-------|---------|---------|
| `must_tell` | Lead story material — everyone in the audience needs to know | Major model update, breaking regression in a widely-used tool |
| `solid` | Belongs in the digest — clear event, clear relevance | New tool launch, significant feature ship, practitioner finding |
| `filler` | Include only if the digest needs more stories | Minor update, tangential community discussion |
| `skip` | Not worth covering | No real event, wrong audience, pure noise |

## Judgment Guidelines

- **Official releases from major tools are almost always worth telling**, even with zero engagement — they're news by default.
- **Cross-source coverage is a strong signal.** HN + Reddit + X discussing the same thing means something real happened.
- **Zero engagement ≠ unimportant.** RSS feeds and new releases often have no engagement data yet. Judge on the event.
- **Community posts need a high bar.** A Reddit post with 5 upvotes about a personal workflow is not news. A practitioner finding that changes how people use a tool might be.
- **Drama must have a constructive angle.** Only cover controversy if builders can act on it (check billing, update config, switch a workflow).

## Output

Return a JSON array with one object per story evaluated:

```json
{
  "cluster_id": "abc123",
  "include": true,
  "newsworthiness": "must_tell",
  "reasoning": "One sentence — why this matters to builders, or why it doesn't.",
  "lead_angle": "One sentence: what happened and why the audience should care.",
  "category": "launch"
}
```

Category options: `launch`, `update`, `research`, `drama`, `tutorial`, `benchmark`, `opinion`

**Be ruthless.** A great digest has 3–7 stories that each earn their spot. Three strong stories beat seven mediocre ones.
