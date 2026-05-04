# How to Use This Branch

This branch runs the **Twitter news thread** workflow: research → edit → write (with QA loop) → visuals → publish.

The interesting levers are the **prompt files** and **skill files**. This guide covers how to iterate on them efficiently without re-running expensive stages.

---

## Where Things Live

### Prompts — task instructions per stage
```
src/prompts/
  news-editor.md          ← editorial judgment prompt (editor stage)
  news-writer-thread.md   ← thread generation prompt (write stage)
  news-qa.md              ← quality review prompt (qa stage)
  visuals-scout.md        ← image resolution prompt (visuals stage)
```

### Skill files — reusable knowledge loaded into agents
```
src/skills/
  thread-writer.md              ← brand voice + full-digest format
  thread-writer-standard.md     ← 4-7 story thread format
  thread-writer-short.md        ← 2-3 story thread format
  thread-writer-single.md       ← single story format
  news-research-sources.md      ← source tiers + freshness rules (researcher)
  news-editorial-standards.md   ← newsworthiness rubric (editor)
```

Skills are injected into the agent's system prompt via named placeholders. Each key in `config.skills` maps to a `{{skill_<key>}}` placeholder in the prompt file:

```json
// agents/example/config.json
"skills": {
  "voice":  "src/skills/brand-voice.md",
  "format": "src/skills/thread-writer.md"
}
```
```
// src/prompts/example.md
{{skill_voice}}

{{skill_format}}
```

The runner replaces all matching placeholders at runtime. Any placeholder with no matching key is stripped before the prompt reaches Claude.

For runtime skill selection (e.g. the x-writer picks a format skill based on story count), the agent code passes `skillOverrides` to override or extend `config.skills` for that specific run. The prompt still uses a plain named placeholder — `{{skill_content}}` in the writer's case.

### Agent definitions — identity + config per agent
```
agents/
  researcher/   editor/   x-writer/   visuals-scout/   qa/   publisher/
    config.json   ← model, tools, which skill files to load
    system.md     ← the agent's role (what it is, not what to do)
```

---

## Setup

Copy `.env.example` to `.env` and fill in the required values:

| Variable | Required for | Where to get it |
|---|---|---|
| `PARALLEL_API_KEY` | All agents (Claude) | Anthropic console |
| `GITHUB_TOKEN` | Researcher (releases, velocity) | GitHub → Settings → Tokens |
| `TYPEFULLY_API_KEY` | Publisher only | Typefully → Settings → API |
| `TYPEFULLY_SOCIAL_SET_ID` | Publisher only | Typefully → Settings → API |

Everything up to and including the write stage runs with just `PARALLEL_API_KEY` and `GITHUB_TOKEN`.

Then install dependencies:
```bash
npm install
```

---

## Running the Workflow

### Full run (no publish)
```bash
npm run thread
```

### Full run + post to Typefully
```bash
npm run thread:publish
```

### Stop after a specific stage
```bash
# Run research + edit only — inspect editorial decisions before writing
npm run thread -- --until edit
```

### Resume from a stage (uses cached output from earlier stages)
```bash
npm run thread -- --from write
npm run thread -- --from write --run-dir data/runs/twitter-news-thread-2026-05-04
```

---

## Iterating on Prompts and Skill Files

The most common loop: **collect news once, iterate on the writer**.

```bash
# Step 1: Run through edit to get a set of curated stories
npm run thread -- --until edit

# The run dir is printed at the end, e.g.:
# data/runs/twitter-news-thread-2026-05-04

# Step 2: Edit src/prompts/news-writer-thread.md or src/skills/thread-writer*.md

# Step 3: Re-run just the write stage (skips research + edit)
npm run thread -- --from write --run-dir data/runs/twitter-news-thread-2026-05-04

# Step 4: Inspect the output
cat data/runs/twitter-news-thread-2026-05-04/write/output.json | jq '.x_thread.segments[].text'

# Repeat steps 2–4 until the thread is good
```

### Iterating on editorial judgment

```bash
# Run research once
npm run thread -- --until research

# Edit src/skills/news-editorial-standards.md or src/prompts/news-editor.md

# Re-run edit against cached research
npm run thread -- --from edit --run-dir data/runs/twitter-news-thread-2026-05-04
```

### Running a single agent directly
```bash
# Researcher only (writes to data/runs/test-run/research/output.json)
mkdir -p data/runs/test-run/research
echo '{}' > data/runs/test-run/research/input.json
./scripts/run-agent.sh --agent researcher --run-dir data/runs/test-run --stage research

# Writer against a custom stories file
cp data/runs/twitter-news-thread-2026-05-04/edit/output.json data/runs/test-run/write/
# (edit the stories in write/input.json if needed, then:)
./scripts/run-agent.sh --agent x-writer --run-dir data/runs/test-run --stage write
```

---

## Inspecting Outputs

Each stage writes to its own subdirectory:

```
data/runs/twitter-news-thread-YYYY-MM-DD/
  state.json               ← which stages are done/pending/failed
  research/
    output.json            ← NewsItem[] (all collected items)
    agent.log              ← stdout from the researcher
  edit/
    output.json            ← EditorialDecision (selected stories + reasoning)
    agent.log
  write/
    output.json            ← DigestContent (the full X thread)
    agent.log
  visuals/
    output.json            ← DigestContent with media[] populated
    media/                 ← downloaded images (seg-*.png)
    agent.log
  publish/
    output.json            ← Typefully draft ID + URL
    agent.log
```

### Quick inspection commands

```bash
# What stories did the editor pick?
cat data/runs/.../edit/output.json | jq '.stories[] | {rank, title, newsworthiness: .significance}'

# What does the thread look like?
cat data/runs/.../write/output.json | jq -r '.x_thread.segments[].text'

# Check if a stage succeeded
cat data/runs/.../state.json | jq '.stages'
```

---

## What Controls What

| You want to change... | Edit this |
|-----------------------|-----------|
| Which stories get picked | `src/skills/news-editorial-standards.md` or `src/prompts/news-editor.md` |
| Thread format and voice | `src/skills/thread-writer*.md` |
| Thread generation instructions | `src/prompts/news-writer-thread.md` |
| Which sources to monitor | `src/skills/news-research-sources.md` (documentation) or `src/agents/news-researcher.ts` (implementation) |
| QA scoring criteria (runs inside write stage) | `src/prompts/news-qa.md` |
| Image resolution strategy | `src/prompts/visuals-scout.md` |
| What an agent fundamentally is | `agents/<id>/system.md` |
| Which skills an agent loads | `agents/<id>/config.json` → `skills` |
| Which model an agent uses | `agents/<id>/config.json` → `model` |
