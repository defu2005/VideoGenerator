# TASK-004H-FIX2 — agy: stop the `--json-schema` / `finish`-tool double answer

## Problem (diagnosed live)
When a structured (JSON) request goes to Antigravity CLI (`agy`), the provider passes
`--json-schema <file>`. With that flag agy expects the model to submit its answer through
an internal `finish` tool. Our prompt (`NO_TOOLS_RULE`) forbids every tool, so the model:

1. writes the JSON as plain text,
2. agy replies "You did not call any tools… call the finish tool",
3. the model sends the same JSON again via `finish`.

The app receives two JSON objects back to back. `extractJson` in
`apps/server/src/providers/llm/structured.ts` slices from the first `{` to the last `}`,
so `JSON.parse` fails → "LLM response contained malformed JSON" → repair/retry, doubling
tokens (one failed RESEARCH run used ~104K tokens across 3 attempts).

## Changes

### 1. `apps/server/src/providers/llm/antigravityCli.ts`
- Remove the block that writes `schema.json` and pushes `--json-schema` (the
  `if (request.json && (request.jsonSchema || request.schemaName))` block in `args`).
  JSON shape stays enforced by the prompt and by the app's own validation/repair in
  `structured.ts`.
- Remove the now-unused `writeFileSync` import (keep anything still used). Do not touch
  `NO_TOOLS_RULE`, `NO_TOOLS_RETRY`, the `generate` retry, parsing or failure mapping.

### 2. `apps/server/src/providers/llm/structured.ts` — make `extractJson` tolerant
Keep current behaviour first (fence strip, first `{` … last `}`, `JSON.parse`). Only if
that parse fails, fall back to scanning for the **first balanced top-level JSON object**
(track brace depth, ignore braces inside JSON strings, handle `\"` escapes) and parse that.
If the fallback also fails, throw the same `SyntaxError("LLM response contained malformed JSON")`.
This protects every provider against "JSON + trailing text/second JSON" replies.

### 3. Tests (Vitest, fake spawn only — never run the real agy)
- `apps/server/test/antigravityCli.test.ts`: replace the test
  "writes and passes a JSON schema file when structured output is requested" with
  "does not pass --json-schema for structured requests": same request (`json: true`,
  `schemaName`, `jsonSchema`), assert `capturedArgs` does not contain `--json-schema`
  and the response text comes back.
- Add structured-output tests (in the existing structured test file, or a new
  `apps/server/test/structuredExtract.test.ts` going through the public API that uses
  `extractJson`):
  - two identical JSON objects concatenated (`{"a":1}\n{"a":1}`) → parses to `{a:1}`;
  - JSON followed by prose containing a `}` → parses the first object;
  - braces inside string values (`{"t":"a } b"}`) parse correctly;
  - truly broken JSON still fails as before.

## Rules
- No new dependencies, no migrations, no `git commit`/`push`.
- Do not run real copilot/claude/agy CLIs in tests.
- Never use `--dangerously-skip-permissions` or any agy mode other than `plan`.
- Run: `npm run typecheck`, `npm test` (whole repo) — all must pass.

## Done
Write `docs/tasks/TASK-004H-FIX2.report.md` (what changed, test results) and create an
empty `docs/tasks/TASK-004H-FIX2.done`.
