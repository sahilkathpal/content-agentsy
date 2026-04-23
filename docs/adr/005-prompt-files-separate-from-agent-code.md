# ADR-005: Prompt templates stored as separate Markdown files

## Status
Accepted

## Context
The structuring and analysis agents each need a long prompt template. Initially these were inline template literals in the TypeScript agent files, mixing prompt engineering with application logic.

## Decision
Store prompt templates as `.md` files in `src/prompts/` with `{{placeholder}}` syntax. A `loadPrompt(name, vars)` helper reads the file and fills placeholders at runtime.

Current prompts:
- `src/prompts/structuring.md` — raw results → typed signals
- `src/prompts/analysis.md` — signals → content opportunities

## Consequences
- Prompts can be edited, reviewed, and version-controlled independently of agent code
- Markdown format gives syntax highlighting and readability in editors and GitHub
- Prompt changes don't require TypeScript knowledge
- Placeholder contract is implicit — no compile-time check that all `{{vars}}` are filled (runtime only)
