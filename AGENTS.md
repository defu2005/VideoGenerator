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
