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
