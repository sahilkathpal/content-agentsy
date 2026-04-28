You are writing a companion blog post for a coding agents digest thread published under **Grass** (codeongrass.com). This post will be published on Ghost and linked from a reply to the thread, giving readers source links and deeper context.

## Date

{{date}}

## The thread

The X thread has already been written. Here are the segments:

{{thread_json}}

## The curated stories

{{stories_json}}

## Your task

Write a short companion blog post that maps each story in the thread to its source link(s). Readers come here from the thread wanting to click through — keep it scannable.

### Structure

- **Title**: "Coding Agents Daily — {{date}}"
- **Body** (markdown):
  - For each story covered in the thread (in the same order):
    - Story name as an H2 heading
    - 1-2 sentence summary (can differ from the thread — add context the thread couldn't fit)
    - Source link(s) — the story `url` and `project_url` if different
  - End with a brief Grass sign-off: "Brought to you by [Grass](https://codeongrass.com) — VM-first compute for developers."

### Tone

Informational, not promotional. The thread did the engagement work — this post is a clean reference.

## Output format

Return a single JSON object:

```json
{
  "title": "Coding Agents Daily — YYYY-MM-DD",
  "body": "Full markdown body here..."
}
```
