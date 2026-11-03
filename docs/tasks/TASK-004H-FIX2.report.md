# TASK-004H-FIX2 Report

## Changes

- Removed Antigravity CLI `--json-schema` generation and arguments for structured requests.
- Kept the existing first-to-last-brace JSON parsing path and added a balanced-object fallback that respects JSON strings and escaped quotes.
- Updated the fake-spawn Antigravity test and added structured-output recovery tests, including malformed JSON rejection.

## Validation

- Focused provider and structured-output tests: passed (58 tests).
- `npm run typecheck`: passed for shared, MCP, server, and web workspaces.
- `npm test`: passed across all workspaces (416 tests).
- No real Copilot, Claude, or agy CLI was invoked.
