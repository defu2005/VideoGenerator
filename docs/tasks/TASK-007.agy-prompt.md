Prompt for scripts/agy-task.ps1 (Antigravity CLI). Everything after the line below is sent to the agent.

---

You are the implementer for this repository (TypeScript monorepo: packages/shared, apps/server, apps/web, apps/mcp; npm workspaces; Vitest). The shell starts in the repository root.

Task: implement TASK-007 exactly as specified in `docs/tasks/TASK-007.md`. Read `docs/ARCHITECTURE.md` section 6 first.

A previous agent (GitHub Copilot) started this task and stopped when it ran out of quota. Its partial work is in the working tree (`git status`, `git diff`; e.g. `apps/server/src/services/imageStore.ts`, `visualService.ts`, `api/visuals.ts`, schemas). Keep it: review it against the spec, fix what is wrong, and complete everything that is missing, including all tests and the web Visuals tab.

Rules:
- Never hand-write or edit database migrations. For schema changes run `npx drizzle-kit generate --name visual_review` in `apps/server`.
- Tests must not hit the network. Do not add dependencies.
- Do not run real `copilot`, `claude` or `agy` prompts. Do not commit or push (commits are blocked anyway).
- Do not change `.env`, `.claude/`, `scripts/` or anything under `data/`.

Before finishing, from the repository root: `npm run typecheck`, `npm run build`, `npm test` must pass, and `npx drizzle-kit generate` in `apps/server` must report "No schema changes".

Then write `docs/tasks/TASK-007.report.md` (files, migration, what Copilot had done vs. what you did, test counts, security tests, deviations) and create the empty file `docs/tasks/TASK-007.done`.
