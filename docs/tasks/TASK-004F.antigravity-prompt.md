Open the folder C:\Users\defu\Documents\videoGenerator as the workspace, then send this prompt to the Antigravity agent:

---

You are the implementer for this repository (TypeScript monorepo: packages/shared, apps/server, apps/web, apps/mcp; npm workspaces; Vitest).

Working directory: the shell already starts in the repository root. Do not prefix commands with `cd`. Allowed shell commands: npm, npx, node, git status/diff/log/show (read-only). If a command is denied, continue with file tools instead of stopping.

Task: finish the TASK-004F fix round.

1. Read `docs/tasks/TASK-004F.md` (the spec), `docs/tasks/TASK-004F.review.md` (required fixes F1–F7 + the "Continuation note" at the end) and `docs/tasks/TASK-004F.report.md`.
2. A previous agent session was interrupted (quota error). Its partial edits are in the working tree (see `git diff`). **Keep them.** For each of F1–F7, decide whether it is done, and complete what is missing, including the tests listed for each item.
3. Rules:
   - Never hand-write or edit database migrations. If a schema change is needed, run `npx drizzle-kit generate` from `apps/server`.
   - Tests must not hit the network.
   - Do not add dependencies.
   - Do not run real `copilot` or `claude` CLI prompts.
   - Do not commit.
4. Before finishing, run from the repo root: `npm run typecheck`, `npm run build`, `npm test`. Also run `npx drizzle-kit generate` in `apps/server` and expect "No schema changes". All must pass.
5. Append a section `## Fix round 1` to `docs/tasks/TASK-004F.report.md` containing:
   - for each of F1–F7: whether it was done before the interruption or completed now, with the files changed
   - test counts
   - the F7 live/mock evidence
6. Finally, create the empty file `docs/tasks/TASK-004F.fix-done`.
