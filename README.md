# How to Use This Branch

This branch runs the **Twitter news thread** workflow: research → edit → write (with QA loop) → visuals → publish.

The interesting levers are the **prompt files** and **skill files**. This guide covers how to iterate on them efficiently without re-running expensive stages.

---

## Where Things Live

All editable content lives under `content/pipelines/twitter-news/`.

### Prompts — workflow instructions per stage

Each agent's prompt file contains the full workflow instructions for its stage. The harness pre-loads this file and passes it to the agent before the run starts.

```
content/pipelines/twitter-news/prompts/
  news-researcher.md      ← research methodology (researcher stage)
  news-editor.md          ← editorial judgment prompt (editor stage)
  news-writer-thread.md   ← thread generation prompt (write stage)
  news-qa.md              ← quality review prompt (qa stage)
  visuals-scout.md        ← image resolution prompt (visuals stage)
```

### Skill files — reusable knowledge referenced by prompt files

Each skill is a directory containing a `SKILL.md`. Prompt files reference skills by path. Agents load the relevant skill files at runtime via the Read tool — which means skills are picked dynamically (e.g. the writer picks a different thread format skill based on story count).

```
content/pipelines/twitter-news/skills/
  thread-writer/              ← brand voice + full-digest format
  thread-writer-standard/     ← 4-7 story thread format
  thread-writer-short/        ← 2-3 story thread format
  thread-writer-single/       ← single story format
  news-research-sources/      ← source tiers + freshness rules (researcher)
  news-editorial-standards/   ← newsworthiness rubric (editor)
  SKILL_INDEX.md              ← index of all skills with descriptions
```

Each skill directory has the structure:
```
skills/<name>/
  SKILL.md          ← the skill content the agent reads
  references/       ← optional supplementary files (for human authors)
```

### Agent definitions — identity + config per agent

```
content/pipelines/twitter-news/agents/
  researcher/   editor/   x-writer/   visuals-scout/   qa/   publisher/
    system.md     ← the agent's system prompt (permanent identity, workflow-agnostic)
    config.json   ← fully authoritative agent manifest
```

`system.md` defines who the agent is — role, voice, hard constraints. It doesn't change per run.

`config.json` is the live manifest for an agent. All fields are read and enforced by the runner:

| Field | What it controls |
|---|---|
| `model` | Which Claude model to use |
| `prompt_file` | Path to this workflow's instruction file (pre-loaded by harness) |
| `server_name` | MCP server key for the agent's tools |
| `tools` | Short tool names the agent can call (MCP tools only) |
| `builtin_tools` | Built-in tools: `Read` for most agents, `["Bash", "Read"]` for visuals-scout |
| `max_turns` | Max agentic turns before the run is terminated |
| `skills` | Skill directories to validate at startup — catches path errors before the agent runs |

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

# Step 2: Edit content/pipelines/twitter-news/prompts/news-writer-thread.md
#         or content/pipelines/twitter-news/skills/thread-writer*/SKILL.md

# Step 3: If you want to compare outputs across runs, rename the existing output
#         before re-running — otherwise it gets overwritten.
mv data/runs/twitter-news-thread-2026-05-04/write/output.json \
   data/runs/twitter-news-thread-2026-05-04/write/output-before.json

# Step 4: Re-run just the write stage (skips research + edit)
npm run thread -- --from write --run-dir data/runs/twitter-news-thread-2026-05-04

# Step 5: Inspect the output
cat data/runs/twitter-news-thread-2026-05-04/write/output.json | jq -r '.x_thread.segments[].text'

# Repeat steps 2–4 until the thread is good
```

### Iterating on editorial judgment

```bash
# Run research once
npm run thread -- --until research

# Edit content/pipelines/twitter-news/skills/news-editorial-standards/SKILL.md
# or content/pipelines/twitter-news/prompts/news-editor.md

# Re-run edit against cached research
npm run thread -- --from edit --run-dir data/runs/twitter-news-thread-2026-05-04
```

---

## Testing

### Schema validation (fast, no LLM calls)

Once you have fixture files (see below), this validates that all saved outputs still match their Zod schemas. Fast enough for a pre-commit check.

```bash
npm run test:shapes
```

### Running a single agent against fixtures

Run one agent with saved fixture input, validate output shape, and print the result for review:

```bash
npm run test:editor    # runs editor with researcher-output.json as input
npm run test:writer    # runs writer with editor-output.json as input
npm run test:qa        # runs qa with writer-output.json as input
npm run test:researcher  # runs researcher live (no fixture input needed)
```

Add `--review` to any command to print the full output.

### Regenerating fixtures after a prompt change

When you change a prompt or skill file, the agent's output changes — and downstream fixtures go stale. Regenerate from the changed stage forward:

```bash
# Regenerate all stages
npm run test:regen

# Regenerate from editor forward (uses saved researcher output as input)
npm run test:regen:edit

# Custom cascade: regenerate writer + qa only
npx tsx tests/regen.ts --writer --qa
```

**Prompt change workflow:**
1. Edit prompt or skill file
2. `npm run test:<agent>` → verify the output looks right
3. `npm run test:regen:edit` (or appropriate cascade) → update downstream fixtures
4. `npm run test:shapes` → confirm all schemas still hold

### Generating initial fixtures

Copy stage outputs from a real pipeline run:

```bash
RUN=data/runs/twitter-news-thread-YYYY-MM-DD
cp $RUN/research/output.json tests/fixtures/researcher-output.json
cp $RUN/edit/output.json     tests/fixtures/editor-output.json
cp $RUN/write/output.json    tests/fixtures/writer-output.json
cp $RUN/qa/output.json       tests/fixtures/qa-output.json
```

After that, `npm run test:regen` keeps them up to date.

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
cat data/runs/.../edit/output.json | jq '.stories[] | {rank, title, significance}'

# What does the thread look like?
cat data/runs/.../write/output.json | jq -r '.x_thread.segments[].text'

# Check if a stage succeeded
cat data/runs/.../state.json | jq '.stages'
```

---

## What Controls What

| You want to change... | Edit this |
|-----------------------|-----------|
| Which stories get picked | `content/pipelines/twitter-news/skills/news-editorial-standards/SKILL.md` or `content/pipelines/twitter-news/prompts/news-editor.md` |
| Thread format and voice | `content/pipelines/twitter-news/skills/thread-writer*/SKILL.md` |
| Thread generation instructions | `content/pipelines/twitter-news/prompts/news-writer-thread.md` |
| Which sources to monitor | `content/pipelines/twitter-news/skills/news-research-sources/SKILL.md` |
| QA scoring criteria | `content/pipelines/twitter-news/prompts/news-qa.md` |
| Image resolution strategy | `content/pipelines/twitter-news/prompts/visuals-scout.md` |
| What an agent fundamentally is | `content/pipelines/twitter-news/agents/<id>/system.md` |
| Model, tools, max turns | `content/pipelines/twitter-news/agents/<id>/config.json` |
