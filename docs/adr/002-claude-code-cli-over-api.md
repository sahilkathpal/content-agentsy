# ADR-002: Use Claude Code CLI instead of Anthropic API SDK

## Status
Accepted

## Context
The structuring and analysis steps need to call Claude. The original design used the `@anthropic-ai/sdk` npm package, which requires an `ANTHROPIC_API_KEY` and adds a dependency. Since this project is already run from within a Claude Code environment, the CLI is available and authenticated.

## Decision
Shell out to `claude -p --output-format text --max-turns 1` via Node.js `spawn` instead of using the Anthropic SDK. Prompts are streamed via stdin, responses collected from stdout.

The `CLAUDECODE` environment variable is unset in the spawn call to allow nested invocation.

## Consequences
- No API key needed for LLM calls — one fewer secret to manage
- Removed `@anthropic-ai/sdk` as a dependency
- LLM model selection is governed by the user's Claude Code configuration, not hardcoded in the app
- Slightly less control over parameters (temperature, max_tokens) compared to direct API access
- Requires `claude` CLI to be installed and authenticated on the machine running the pipeline
