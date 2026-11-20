# TASK-074c-3c-2c — web: accepted list, draft and accept actions

Status: implemented in the working tree. Not committed, no `.done`. The app was not started and no browser preview was opened, so the UI has never been seen in a browser.
Scope: `apps/web` only. The server is unchanged in this slice.

## What changed

- `apps/web/src/features/operator/ToolProposals.tsx`
  - New accepted query `GET /api/operator/tool-proposals/accepted`, enabled only when the section is open. Key `["operator","tool-proposals","accepted"]`, so the prefix `["operator","tool-proposals"]` invalidates both lists.
  - Accepted rows show a draft button when `draftedAt` is null. When `draftedAt` is set they show the marker `Bản nháp guide — cần Claude xem lại trước khi giao Codex/Cursor` in the row body. The `IMP-n` label appears only when `impNumber` is not null. The server assigns `impNumber` at first draft, so a freshly accepted row has none.
  - Open rows gain an accept button (`POST …/:id/accept`). The existing dismiss button is unchanged.
  - `POST …/:id/draft` is a mutation with `onSettled` refresh. Every settle (2xx or error) invalidates both lists. A failed run can already have assigned a number or spent the budget.
  - A progress line `<name> Đang soạn bản nháp…` shows while the draft runs.
  - The draft outcome is a `role="status"` paragraph outside the row branch, naming the row in `<strong>`. The refetch that removes the draft button does not hide it. `drafted` shows `Đã soạn bản nháp IMP-n.`; pending, refused and skipped show their reason text. An unknown reason shows `Không soạn được bản nháp.` through an own-key check, not an inherited object key.
  - The reason map is typed `Record<RefusedReason | SkipReason | "budget_limit", string>`, so a missing reason fails the typecheck.
  - One alert slot (`role="alert"`) shows the first error among the lists, dismiss, accept and draft.
- `apps/web/src/features/operator/ToolProposals.test.tsx` (new, 19 tests).

## Fixture check against the server

Read before the fixtures were trusted:

- `apps/server/src/operator/toolProposals.ts` `listAcceptedToolProposals` (`:99-109`): same item shape as the open list, plus `impNumber` (number or null) and `draftedAt` (ISO string or null). Accepted-but-undrafted fixtures use `impNumber: null`.
- `apps/server/src/operator/toolProposals.ts` `acceptToolProposal` (`:133-136`) only sets status; `assignImpNumber` (`:142-152`) assigns MAX+1 at first draft.
- `apps/server/src/api/operator.ts` accept (`:122`): returns `{ ok: true }`. Draft (`:129-136`): `drafted` returns `{status, impNumber}`; other outcomes return the `DraftResult` body.
- The 500 body is `{error:{code:"INTERNAL_ERROR", message:"An internal server error occurred"}}` (`app.ts:1189-1194`). The fixture matches.
- `apps/web/src/test/setup.ts` imports `@testing-library/jest-dom/vitest`, so `toHaveTextContent` is available.

Limit: the fixtures are checked against the source by reading it. The live route was not called (the app is off).

## Tests

- Red run, first version of the file (9 tests): all 9 failed. The output was truncated to the last test's failure (`drafted_tool` not found, accepted list absent). The reasons of the other eight were not captured. This is a gap; it is not repaired by the mutation checks below.
- The file was then extended to 19 tests. The extended cases were run only against the finished component, not red first. The mutation checks below are the substitute evidence for them.
- Run results (observed in the logs):
  - `ToolProposals.test.tsx` + `OperatorPage.test.tsx`: 2 files, 22 tests passed (19 + 3).
  - `npm run typecheck` in `apps/web`: exit 0.
  - Full web suite `npx vitest run`: 94 files, 273 tests passed, exit 0 (log: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\web-full.log`).

### Mutation checks (run after the final component, restored each time, `cmp` identical)

Each mutation was applied to `ToolProposals.tsx`, the test file ran, then the component was restored from a backup and compared byte-for-byte.

| # | Mutation | Result |
|---|----------|--------|
| M1 | Accepted query `enabled: open` changed to `true` | 1 fail: "does not fetch either list before the section opens" |
| M2 | Refresh invalidates only the accepted key | 3 fail: drafting refresh, budget-limit refresh, accept refresh |
| M3 | Draft refreshes only on `drafted` (no refresh on other 2xx or on error) | 2 fail: budget-limit refresh, 500 refresh |
| M4 | Progress line removed | 1 fail: progress line test |
| M5 | Own-key check removed (`return true`) | 1 fail: unknown-reason fallback |
| M6 | Row name removed from the outcome line | 1 fail: drafting test (name in outcome) |
| M7 | Outcome hidden once its row shows as drafted (the outcome lives in a row that the refetch removes) | 1 fail: drafting test (outcome survives the refetch) |

All seven mutations were caught. Each restore was checked with `cmp` against the backup and matched the finished component.

Added after the first mutation pass: an `IMP-7` assertion on the drafted row's summary in the listing test. The targeted run after this edit is 22 of 22; typecheck exit 0. The full web suite was not re-run after this one-assertion edit; its last run (273 tests) predates it.

## Limits

- `OperatorPage.test.tsx` does not reference `tool-proposals` and never opens the section. It passes, but it does not exercise the new `/accepted` GET. The full suite passing shows no break, not coverage of that request.
- A draft 500 refreshes the lists (`onSettled`), so a row the server left accepted with `drafted_at` NULL is shown as it is. The UI never shows a false marker.
- The marker and the draft button are inside a closed `<details>` row, as the dismiss button already is. They are visible after the row is expanded.
- The accept button has no existing web caller. The accept route is user-only; the web session is a user actor, but this was not exercised against a running server.
- The UI was never seen in a browser. The app is off and no `preview_start` was used.
- Red-run gap: the first 9 tests were not shown red individually (see Tests above).
- A draft error stays in the single alert slot after a later successful accept or dismiss, until the next draft. Dismiss already behaves this way. Not changed in this slice.

## Not done

No commit, no push, no `.done`. No server change. No migration. No dismiss-route change. No research-runner wiring. No accepted → in_progress transition. No write to `data/`, `data-dev/`, or real `docs/proposals/`.
