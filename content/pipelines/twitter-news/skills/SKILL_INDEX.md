# Skill Index — twitter-news pipeline

Skills are reusable instruction documents loaded by agents at runtime via the Read tool.
Each skill lives in its own directory as `SKILL.md`.

| Skill directory | Used by | Description |
|---|---|---|
| `news-research-sources/` | researcher | Source tiers (T1–T4), freshness rules, and event-driven sourcing strategy |
| `news-editorial-standards/` | editor | Newsworthiness rubric, audience definition, story selection criteria |
| `thread-writer/` | x-writer | Full brand voice guide for 8+ story digests |
| `thread-writer-standard/` | x-writer | Voice and format for 4–7 story threads |
| `thread-writer-short/` | x-writer | Voice and format for 2–3 story threads |
| `thread-writer-single/` | x-writer | Voice and format for single-story deep dives |

## Adding a new skill

1. Create `content/pipelines/twitter-news/skills/<skill-name>/SKILL.md`
2. Reference the skill directory in the relevant agent's `config.json` → `skills` array
3. Reference the skill path in the relevant prompt file so the agent knows to read it

## Skill vs prompt file vs system.md

- **system.md** — agent identity and universal rules (never changes per run)
- **Prompt file** — workflow instructions for this pipeline (changes when the pipeline changes)
- **Skill file** — reusable depth on a specific topic (shared across agents or pipelines)
