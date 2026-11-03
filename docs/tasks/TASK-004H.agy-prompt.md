# TASK-004H — prompt for Antigravity CLI (agy)

Dispatch: `powershell -ExecutionPolicy Bypass -File scripts/agy-task.ps1 docs/tasks/TASK-004H.agy-prompt.md`
Only the text after the first `---` line is sent.

---
You are the implementer for TASK-004H in this repository (TypeScript monorepo: packages/shared, apps/server, apps/web, apps/mcp; Vitest).

Read docs/tasks/TASK-004H.md fully and implement it. Also read docs/ARCHITECTURE.md (LLM providers, routing) and the existing CLI providers in apps/server/src/providers/llm/ (claudeCli.ts, copilotCli.ts, the CLI base class, registry.ts) and follow their patterns exactly.

Rules:
- Do NOT run `agy`, `claude`, `copilot` or any real LLM CLI, and tests must not hit the network or real CLIs. Use the fixtures in apps/server/test/fixtures/agy-1.4.12-*.json if present; otherwise write against the shape documented in the spec and mark those tests `it.todo`.
- Spawn agy with an args array, never through a shell. Use only `--mode plan` in the provider. Never use --dangerously-skip-permissions in app code.
- Do not add dependencies. Do not hand-write migrations (none should be needed). Do not commit or push (git hooks will refuse anyway).
- Do not touch .env, .claude/, scripts/, data/.
- UI text is Vietnamese, matching apps/web/src/features/settings/AiSettingsPage.tsx.

When finished, run from the repo root: `npm run typecheck`, `npm run build`, `npm test`, and in apps/server `npx drizzle-kit generate` (expect "No schema changes"). Fix everything until all pass.

Then write docs/tasks/TASK-004H.report.md (what changed, files, test results, anything not done) and create an empty file docs/tasks/TASK-004H.done.
