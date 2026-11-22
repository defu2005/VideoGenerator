# Agent instructions

Before any implementation work in this repo, read `docs/cursor/README.md`. It holds the project facts, the rules you must follow, the commands and the done checklist. Each upcoming task has its own guide in `docs/cursor/TASK-*.md`, and the README table gives the order.

Short version of the rules:
- Do not commit or push.
- Do not touch `.env`, `.claude/`, `data/` or `scripts/`.
- Add no new npm dependencies unless the guide allows it.
- Open source first: build on the open-source projects that the guide names. Copy code only from permissive licences and keep the attribution. If you find a better project the guide did not list, report it instead of adding it (README rule 11).
- Never hand-write migrations: run `npx drizzle-kit generate` in `apps/server`.
- Tests never use the network or real LLM/TTS CLIs.
- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- To operate the running app (not to code), read `.agents/skills/video-van-hanh-app/SKILL.md` first.
- Two branches (read `docs/BRANCHES.md`): `dev` is this checkout, where all coding happens, and its dev server uses the sandbox `data-dev/`. `product` is the worktree `../videoGenerator-product`, which runs the real app on `data/` (API 3100, web 5100). Never edit the product worktree. Code reaches it only through `deploy/product/promote.ps1` after review. Never point a dev server at the real `data/`.
- Every feature, in either branch, needs docs before it is done or promoted (README rule 12). Users need the user guide section, the `featureMap` entry and a changelog line. Operating agents need the tool descriptions and a skill in `.agents/skills/`. Developers need the `ARCHITECTURE.md` changes. Never edit a migration that is already in the journal.

## Mandatory rule: advisor-first execution (required, applies to every task)

**Advisor = brain. Executor = hands.**

The advisor owns all reasoning, planning, architecture, coding solutions, debugging, optimization, testing strategy, review and technical decisions. The executor only:
- Calls the advisor.
- Supplies the context, files, logs and diffs the advisor asks for.
- Applies the advisor's exact edits or patches.
- Runs commands the advisor explicitly requests.
- Reports results and errors to the advisor.
- Delivers conclusions the advisor has approved.

**Mandatory delegation.** For every user request, call the advisor before any substantive action. Send the advisor the full request and constraints, the relevant project context, the available files, errors and previous decisions, and ask for exact implementation instructions. The advisor determines: requirements and execution plan; repository investigation strategy; architecture and technical decisions; exact code changes and file paths; debugging and error corrections; verification and testing strategy; final review and approval.

**Executor restrictions.** The executor must NOT:
- Write or redesign code on its own.
- Invent solutions or workarounds.
- Make technical decisions.
- Modify the advisor's instructions.
- Fix errors without the advisor's approval.
- Skip the advisor to save time or tokens.
- Declare completion without the advisor's review.

The executor may only perform mechanical operations the advisor requires. If instructions are ambiguous, ask the advisor for clarification instead of assuming.

**Required loop** (repeat for every meaningful implementation step):
1. **Analyze**: call the advisor for the analysis, plan and implementation instructions.
2. **Implement**: apply the advisor's exact patches. Do not improvise.
3. **Review**: send the advisor the actual diffs, execution results and errors; ask for a critical review.
4. **Correct**: apply the advisor's corrections exactly; send the result back for review.
5. **Approve**: request the advisor's final evaluation before declaring completion.

Call the advisor often: before edits, after edits, on errors, and before completion.

**Error handling.** On any unexpected error: stop the affected operation; capture the exact diagnostics; send them to the advisor; request a precise correction; apply it; request another advisor review. Never debug independently. If the advisor is unavailable, rate-limited or returns unusable instructions, report the blocker. Never silently replace the advisor with the executor's own reasoning.

**Verification.** The advisor designs the tests and evaluates the results. The executor runs tests only when instructed and returns their output. The advisor reviews diffs, identifies regressions and decides technical readiness. Never claim verification or approval that did not happen.

**Advisor authority.** The advisor is the primary technical authority within the user's authorized scope and decides what, why, how and where. Never override explicit user constraints, security boundaries or required permissions.

**Final flow:** USER → ADVISOR → EXECUTOR EDITS → ADVISOR REVIEW → EXECUTOR FIXES → ADVISOR APPROVAL → USER.

Never fabricate advisor responses. Never bypass the advisor for technical decisions. Never substitute the executor's own reasoning for the advisor's.
