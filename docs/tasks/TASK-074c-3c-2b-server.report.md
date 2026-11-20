# TASK-074c-3c-2b (server) — draft route: coded errors for LLM failures

Status: implemented in the working tree. Not committed, no `.done`. The app was not started. The route was not called on a running server.
Scope: `apps/server/src/api/operator.ts` (the route) and `apps/server/test/toolProposalDraftRoute.test.ts` (tests). No web change. `draftProposal` and `DraftResult` are unchanged.

## Problem

A draft LLM failure reached the draft route as an unhandled error and became `500 INTERNAL_ERROR` ("An internal server error occurred"). That hid the reason from the user. The biggest case is `AUTONOMY_BUDGET_WAIT`, the autonomy spend gate in `providers/llm/structured.ts` (thrown at line 402). The rethrow path is recorded in `docs/tasks/TASK-074c-3c-2b.report.md` (`routeStructured`, when no step succeeds). That path was not re-read in this slice.

## Decision

Advisor decision (2026-11-20): a coded non-2xx mapped in the route, not a typed result in a 2xx body. Reason: `proposalRunner.test.ts` pins that `draftProposal` rejects with the `LlmError` code, so the mapping has to live in the route.

| Case | Status | Code | Message |
|------|--------|------|---------|
| `LlmError` with `AUTONOMY_BUDGET_WAIT` | 429 | `OPERATOR_PROPOSAL_DRAFT_BUDGET_WAIT` | "Hạn mức chi của hệ thống đã hết. Chờ kỳ ngân sách mới rồi soạn lại." plus `details.retryAt` (null when absent) |
| Any other `LlmError` | 502 | `OPERATOR_PROPOSAL_DRAFT_LLM_FAILED` | "Model không soạn được bản nháp. Thử lại sau." |
| Anything else | 500 | `INTERNAL_ERROR` | unchanged (generic) |

The runner's message is never echoed. The route logs the original `LlmError` with `request.log.warn` before mapping it.

Deviation from precedent: `api/llm.ts:339-345` maps `LlmError` to `AppError` but passes `error.message` through. This route does not, because the advisor asked for fixed messages.

The row stays accepted with its number and `drafted_at` NULL. No file is written.

## Web

No change. The coded error arrives as an `ApiRequestError` and the component's single alert slot shows its message.

## Tests

Written first, in `test/toolProposalDraftRoute.test.ts`, before the "Last on purpose" budget test. The file imports `LlmError` from `src/providers/llm/types.ts`.

Logs are in the scratchpad at `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\`. That folder can be cleared; the numbers below are copied from the logs.

- Red run (`server-red.log`): 2 failed, 12 passed (14). The failures were `expected 500 to be 429` and `expected 500 to be 502`. The plain-error test still passed.
- Green run after the route change (`server-draft-green.log`): 4 draft files, 38 of 38 passed. The files are `toolProposalDraftRoute`, `proposalDraft`, `proposalDraftRoot`, `proposalRunner`.
- Server typecheck `npm run typecheck` in `apps/server`, exit 0 (`server-typecheck.log`). The tsconfig excludes `test/`, so this does not cover the test file.
- Full server suite `npx vitest run`, exit 0 (`server-full.log`): 288 files passed, 4 skipped; 2363 tests passed, 9 skipped.

Both new tests assert the spend delta of 1 and that the row stays accepted with its number and no file.

## Limits

- The `llmCalls` unit is spent before the runner runs, so an autonomy budget wait that never reaches a model still costs one unit. The tests assert this (spend delta 1). It is not fixed in this slice.
- The budget-wait test injects an `LlmError` with the code. It does not drive the real gate in `structured.ts` end to end, so the path from the gate through `routeStructured` to the route is not covered by a test.
- Failover, gateway and quota-swap calls are not traced here.
- `details.retryAt` is returned but not asserted by a test.
- A timeout is only mapped when it arrives as an `LlmError`. The HTTP path (`providers/llm/http.ts:27,55`) does that, with code `LLM_TIMEOUT`, and the route maps it to 502. Two places in `structured.ts` (lines 159 and 242) rethrow a raw `AbortError` as it is, so it would reach the route as a plain error and return the generic 500. Not covered by a test. Widening the catch would break the plain-error 500 test, so it was left as it is.
- The 429 is not special-cased by the web client for this route. `apiRequest` keeps the server message; the 429 mapping in `apiClient.ts:120` is only in the sign-in helper.
- Only one full-suite run was made on the final tree. A timeout appeared in an earlier run of the 2b slice; it did not recur here.

## Not done

No commit, no push, no `.done`, no app start, no migration, no write to `data/`, `data-dev/` or `docs/proposals/`, no dismiss-route change, no accepted → in_progress transition.
