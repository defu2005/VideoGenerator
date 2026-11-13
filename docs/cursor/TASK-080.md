# TASK-080 — Clean base: run the checklist, group the commits, new ARCHITECTURE.md 🧹

**Who:** **Claude (the architect session)** runs the checks and writes the documents; **the user** commits and pushes. No implementer session. **Size:** S. **Migration:** none.
**When:** after TASK-125, TASK-119 and the 111/112/113 lane are done, and before TASK-085. No other session may be writing code while this runs.

## Why

The working tree has a very large uncommitted diff (many tasks since `adba5d5`). Until it is committed:
- a bad edit cannot be rolled back;
- TASK-085 (the file split) would be mixed into the same diff;
- TASK-082 (the real run) has no known-good version to come back to.

`ARCHITECTURE.md` is also still v0.2 and describes a much smaller app.

## Steps (Claude)

1. Run the README "Done checklist" for the whole repo:
   - typecheck;
   - the server, shared, web and mcp suites;
   - `npx drizzle-kit generate` (it must say "No schema changes");
   - the user guide coverage test;
   - the skill coverage test.

   Record the counts. If something fails, write a short fix guide (or, if it is one line, tell the user). Do not fix code yourself.
2. Group the diff into commits by task. Use `git status`, `git diff --stat` and the task reports:
   - write `docs/tasks/TASK-080.commit-plan.md`, with one block per commit: a message in the repo style ("feat: TASK-NNN …"), then the exact `git add` path list;
   - files touched by several tasks go into the earliest task that needs them, and the plan says so;
   - migrations go with their task, in number order.
3. Check that nothing secret is staged: `.env`, `data/`, tokens, `*.sqlite`, cookies, and `.claude/` are ignored. List anything suspicious for the user; do not change `.gitignore` yourself.
4. Write the new `ARCHITECTURE.md` (v1.0) from the code as it is now:
   - the apps and packages, the pipeline stages and job system;
   - the registry, tools and policy; the operator, Hermes and the assistant;
   - nodes, the style system, originality, analytics, publishing and finance;
   - the TASK-121 pattern (code owns facts, the agent chooses within limits);
   - links to `docs/ARCHITECTURE-TARGET.md` for what is planned.

   Keep it under ~600 lines; link the deep docs instead of copying them.
5. Hand the user the commit plan. **The user** commits and pushes. Do not run `git commit` or `git push`.

## Mã nguồn mở có sẵn (open source)

- **Conventional Commits** for message style (the repo already uses `feat:`), and **arc42** / **C4 model** for the ARCHITECTURE.md layout (sections, context, containers). Use their headings; no tool needed.

## Done

- [ ] checklist counts recorded; failures turned into guides
- [ ] `docs/tasks/TASK-080.commit-plan.md`
- [ ] secret check listed
- [ ] `ARCHITECTURE.md` v1.0
- [ ] the user confirms the commits are pushed → `docs/tasks/TASK-080.done` (Claude writes it after the user says so)
