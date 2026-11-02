# TASK-001 Review (by Architect)

Verdict: **Accepted with fixes.** Typecheck, build and 17/17 tests verified independently. Real server smoke test OK (health, create, search, 400 on malformed id, dashboard stats, UTF-8 Vietnamese text round-trips correctly).

## Required fixes (TASK-001-FIX)

### F1 — MUST: drizzle-orm security vulnerability
`npm audit --omit=dev` reports HIGH: drizzle-orm <0.45.2, SQL injection via improperly escaped identifiers (GHSA-gpj5-g38j-94v9).
- Upgrade `drizzle-orm` to `^0.45.4` in `apps/server/package.json` (and `drizzle-kit` to a compatible version if needed).
- Do not use `npm audit fix --force` blindly; change only these packages.
- Acceptance: `npm audit --omit=dev` reports 0 vulnerabilities; typecheck/build/test still pass; migrations unchanged or regenerated without schema change.

### F2 — SHOULD: create/delete consistency
- `createProject` creates the directory before inserting the row. Insert the row first, then create the directory; if directory creation fails, delete the row and rethrow.
- `deleteProject`: if removing the directory fails after the row is deleted, log a warning and still return `deleted` (do not return 500 for an orphan directory).
- Add a test for each behavior (mock/stub the fs helper or use an unwritable path).

### F3 — SHOULD: line endings
Add `.gitattributes` with `* text=auto eol=lf` so Windows checkouts do not produce CRLF churn.

## Do not
- Do not change any other behavior, schema, or API shape.
- Do not commit.

## Report
Append a section `## Fix round 1` to `docs/tasks/TASK-001.report.md` with: files changed, `npm audit --omit=dev` output summary, typecheck/build/test results. Then create the file `docs/tasks/TASK-001.fix-done` (empty) as the completion marker.
