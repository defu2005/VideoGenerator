# TASK-124 — One skill pack to operate the app, for every agent, and a loop that keeps extracting skills 🧭

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** M. **Migration:** none expected. If you truly need one, generate it with `npx drizzle-kit generate` in `apps/server` and say why in the report. **New dependency:** none.

**Order:** can run now, beside TASK-116 and TASK-118, if you respect the file boundaries in "Rules". TASK-123 (Hermes fleet sync) and TASK-074b (skill eval, shadow run) come later and will reuse what you build here.

## Goal

Today the know-how to operate Video Agent is spread out:
- 7 operator skills in `.agents/skills/video-*` (channel strategy, topics, metrics, retention, pre-publish check, schedule, experiment report);
- `.cursor/skills/dieu-khien-app/SKILL.md` (MCP control: models, vision, timeouts, retry), which only Cursor sees;
- Hermes's private notes in `~/.hermes/skills/video-generator/SKILL.md`;
- the user guide in `docs/user-guide/*.md`.

Any agent should be able to operate the whole app from **one shared place**. That covers the in-app operator, Hermes (already loads `.agents/skills` through `skills.external_dirs`), Cursor, Codex and Claude Code. And whatever an agent learns while working should come back to that place as a reviewed skill.

Three parts:
1. **Skill pack:** complete `.agents/skills/` so every area of the app has an operator skill, plus one hub skill that says where to start.
2. **Coverage test:** a test that keeps the pack valid and in sync with the tool registry and the user guide.
3. **Extraction loop:** an agent tool to propose a skill draft, user-only activation (unchanged), and a CLI to export approved skills back into `.agents/skills/` so every agent gets them.

## Read first

- `AGENTS.md`, `docs/cursor/README.md`
- `apps/server/src/operator/repoSkills.ts` (`loadRepoSkills`: `<root>/.agents/skills/*/SKILL.md`, no symlinks, ≤ 64 KB, cache by mtime)
- `apps/server/src/operator/skills.ts` (`validateSkillMarkdown`, `parseSkillMarkdown`, `OPERATOR_SKILLS` built-ins)
- `apps/server/src/operator/skillVersions.ts` (`saveSkillDraft`, `activateSkillVersion`, `listSkillVersions`), `skillEval.ts`
- `apps/server/src/operator/service.ts` ~731–800 (`promoteSkill`, `saveSkillEdit`, `activateSkill`, `learningReport`)
- `apps/server/src/api/operator.ts` (skills routes)
- `apps/server/src/assistant/tools.ts` (registry: `find_skills` ~1537, `read_skill` ~1553, `save_skill_report` and the other skill-report tools)
- `apps/mcp/src/tools.ts` (MCP tool names, `app_api` and `checkAppCall`)
- all 7 `.agents/skills/video-*/SKILL.md` (the style to copy) and `.cursor/skills/dieu-khien-app/SKILL.md`
- `docs/user-guide/*.md` (one page per area; `packages/shared` `featureMap` lists the areas)
- tests: `apps/server/test/repoSkills.test.ts`, `skillParse.test.ts`, `skillReports.test.ts`
- `docs/cursor/TASK-059.md` hard limits, `docs/cursor/TASK-123.md` §5 (skill drafts from Hermes), `docs/cursor/TASK-074.md` if present

## What to do

### 1. The skill pack in `.agents/skills/`

Every skill uses the existing frontmatter: `name`, `description` (says *when* to use it), `operator: true`, `area`, `triggers` (Vietnamese with and without accents, a few English), `antiTriggers` if useful, `tools` (only names that exist in the registry), `risk` (`read` | `safe` | `confirm`). It must pass `validateSkillMarkdown`, which means no "TODO", no "…" character, and no secrets, emails or tokens. Write the body in Vietnamese, short and practical, in the same style as `video-doc-so-lieu`, with these parts:
- **Khi nào dùng**;
- **Các bước**: tool by tool, with what to check after each step;
- **Kiểm tra kết quả**;
- **Lỗi hay gặp**: real error codes from the code, such as `VISION_PROVIDER_REQUIRED`, `LLM_INVALID_OUTPUT`, `VISUAL_NEEDS_USER`, stage timeouts, `PROJECT_PROTECTED`;
- **Không được làm**: the TASK-059 hard limits that apply.

Add these skills (adjust names if a better split appears in the code, but keep the `video-` prefix):

| Skill | Covers (user-guide page) |
|---|---|
| `video-van-hanh-app` | **Hub, start here.** How to connect (MCP `video-agent` over stdio, `app_api` for the rest, API key from `data/secrets/local-services.key` is read by the MCP client, never pasted). App ports (API 3001, web 5173). Hard limits. A table: task → skill name. How to propose a new skill (part 3). |
| `video-du-an-va-pipeline` | create a project, run the pipeline, stages and gates, approve/redo, retry a failed stage, quality repair and SHELVED (TASK-121) — `du-an-va-quy-trinh.md` |
| `video-hinh-anh-va-giong` | visual search, vision check, `VISUAL_NEEDS_USER`, image relevance rules (relevance first; free licence only on a tie; never "best of the bad"), voice/TTS providers and voices — `hinh-anh-va-giong-doc.md` |
| `video-render-va-thumbnail` | render engines, timeline, graphics, thumbnails, render failure triage — `render-va-thumbnail.md` |
| `video-dang-bai` | metadata, publish queue, schedule, public-on-schedule rule, platform order — `dang-bai.md` |
| `video-binh-luan` | comment inbox, replies with confirm risk — `binh-luan.md` |
| `video-ho-so-kenh` | profiles, guidelines packs, style packs/looks — `ho-so.md` |
| `video-mo-hinh-ai` | models, LLM routes, vision model, budget modes (ECO/QUALITY), OmniRoute image cap, timeouts — `mo-hinh-ai.md`, `che-do-ngan-sach.md`. Move the content of `.cursor/skills/dieu-khien-app` here. |
| `video-tu-dong-hoa` | topic queue, standing orders, operator queue, cron/schedules — `tu-dong-hoa.md`, `tu-van-hanh.md` |
| `video-xu-ly-su-co` | triage order: health → pipeline state → job log → stage error → which skill fixes it; when to write to `PROPOSALS_AND_BUGS.md` instead of acting — `xu-ly-su-co.md` |
| `video-trich-xuat-ky-nang` | the extraction routine itself (part 3): when a job is worth a skill, how to write it, `propose_skill`, never activate |

Areas that are user-only or secret-bearing (`dang-nhap`, `ket-noi` OAuth, `khong-gian-va-quyen`, `an-toan`) get **no action skill**. The hub lists them as "chỉ người dùng làm" with the user-guide link.

Then turn `.cursor/skills/dieu-khien-app/SKILL.md` into a short pointer: "Kỹ năng vận hành app nằm ở `.agents/skills/` — đọc `video-van-hanh-app` trước." Keep its frontmatter so Cursor still finds it. Add one line to `AGENTS.md` under the short rules: "To operate the running app (not to code), read `.agents/skills/video-van-hanh-app/SKILL.md` first."

Check every tool name against the real registry before you write it. Prefer the named tool over `app_api` whenever one exists.

### 2. Coverage test — `apps/server/test/agentSkillPack.test.ts`

This test needs no network. It reads the real `.agents/skills` from the repo root.
- `loadRepoSkills` on the repo root returns every `video-*` skill and **no rejections**.
- Every skill named in the hub's task table exists.
- Every user-guide area that has app actions is covered: build the expected list from `featureMap` (or the `docs/user-guide` file list) minus an explicit `USER_ONLY_AREAS` set. Each area must map to at least one skill. Map an area either through the skill's `area` value or through a small `AREA_TO_SKILL` table kept in the test.
- Every registry tool that agents may call (not hard-blocked) appears in at least one skill's `tools`, **or** in an `UNCOVERED_TOOLS` list in the test. Each entry in that list carries a one-line reason. The list exists so a new tool cannot ship silently without a skill.
- No skill body contains an email, a `key`/`token` value pattern, or the protected project id except in a "do not touch" line.

### 3. Extraction loop

**a. `propose_skill` tool** in the registry (`apps/server/src/assistant/tools.ts`), risk `safe`, so the operator, the assistant and MCP get it from the one registry. That includes Hermes through `video-agent` MCP.
- Input: `{ markdown: string ≤ 12000, reason: string ≤ 500, basedOn?: string[] }`. `basedOn` holds job, run or project ids, kept as evidence.
- Validate with `validateSkillMarkdown` against the registry. Reject with clear errors and do not save.
- Refuse built-in names (`OPERATOR_SKILLS`) with `BUILT_IN_SKILL`. The name must start with `video-`.
- Save with `saveSkillDraft(..., { source: "agent_proposal", caller, reason, runIds: basedOn }, ...)`. `caller` is the calling identity the registry already knows (operator, assistant, MCP source/agent id). If the evidence type needs widening, widen it; no migration, since evidence is JSON.
- A proposal for a name that already exists in the repo becomes a new version draft. It is not an error.
- Respect the existing daily draft cap. Return `{ name, version, status: "draft" }`.
- **Never activates.** Activation stays as today: the user, through the existing UI or API. Agents get no tool to activate, promote or export. That is a TASK-059 limit: agents cannot widen their own behaviour without the user.
- MCP: expose it through the same registry path the other tools use. If the MCP tool list is hand-written in `apps/mcp/src/tools.ts`, add it there with the same name, and add a test case in `apps/mcp/test/tools.test.ts`.

**b. Show proposals to the user.** The operator skills list already shows drafts. Make sure an `agent_proposal` draft shows its source, caller and reason, so the user knows who proposed it. Keep it small: the existing skills view, one line. Do not touch `apps/web/src/features/team|account|audit` (TASK-116).

**c. Export CLI** — `apps/server/src/cli/exportSkills.ts`, script `"export-skills": "tsx src/cli/exportSkills.ts"` in `apps/server/package.json`, root alias `"export-skills": "npm run export-skills -w @vg/server --"`.
- It reads **active** DB skill versions whose name starts with `video-`.
- It validates each one again and writes it to `<repo>/.agents/skills/<name>/SKILL.md`.
- When that file exists with different content, it prints a diff summary and does **not** overwrite, unless `--write` is passed. Without `--write` it is a dry run that lists what would change.
- It never deletes files and never follows symlinks.
- The user (or the reviewer) runs it and commits. This is how a skill learned by one agent reaches every agent, Hermes included, through `external_dirs`.
- Put the core in a pure function (`planSkillExport(activeVersions, repoFiles) → actions`) and test it.

**d. Align with later tasks.** Leave `// TASK-123` and `// TASK-074b` notes where the Hermes sync sidecar and the skill eval will plug in. The sidecar will call the same `propose_skill` path; 074b will score drafts before the user sees them. Do not build those now.

### 4. User guide

- In `docs/user-guide/tu-van-hanh.md` (or `ket-noi-agent.md`, whichever fits better), add a section **"Kỹ năng dùng chung cho mọi agent"**:
  - where the skills live;
  - that Hermes, Cursor, Codex and the in-app operator read them;
  - how agents propose skills;
  - where the user approves them;
  - `npm run export-skills` (dry run first, then `-- --write`).
- No emails in guide pages: the coverage test rejects them.
- Add a changelog bullet in `nhat-ky-thay-doi.md`.
- If the user-guide coverage test needs the new script or the `propose_skill` tool listed, update it.

## Mã nguồn mở có sẵn (open source)

- **Agent Skills format (`SKILL.md` with YAML frontmatter)** — the open format used by Anthropic's `anthropics/skills` repo and supported by Hermes (`~/.hermes/skills`, `skills.external_dirs`), Cursor and Codex. Our repo skills already follow it, so keep to it and do not invent a new format. Check the licence of `anthropics/skills` before copying any text; prefer reading `skill-creator` there for writing guidance over copying it.
- **Hermes agent skills** (`NousResearch/hermes-agent`, MIT) — its `skill_manage` and creation nudge are the model for "learn after a job". We do not run its code; we only keep our format readable by it.
- **No new library.** Parsing, validation and versioning already exist in `operator/skills.ts` and `skillVersions.ts`.
- If you find a better project (for example a skill linter for the Agent Skills format), report it in the report instead of adding it (README rule 11).

## Tests (no network, no real LLM, no real Hermes)

- `agentSkillPack.test.ts` as in part 2.
- `propose_skill`:
  - a valid draft is saved as `draft` with source, caller and reason;
  - an invalid draft is rejected with errors and nothing is saved;
  - a built-in name is refused;
  - a name without the `video-` prefix is refused;
  - an existing repo name gives a new version;
  - the daily cap is respected;
  - there is no path from this tool to an active skill.
- `planSkillExport`:
  - a new file gives `create`;
  - the same content gives `skip`;
  - different content gives `conflict` without `--write` and `overwrite` with it;
  - a non-`video-` name is ignored;
  - an invalid markdown is reported and not written.
- MCP tool test if you touched `apps/mcp`.
- Run the root typecheck, the full server suite, the web suite, the mcp suite, and `npx drizzle-kit generate` (expect "No schema changes").

## Rules

- AGENTS.md rules apply: no commit or push; do not touch `.env`, `.claude/`, `data/` or `scripts/`; no `npm install`.
- **TASK-116 and TASK-118 are running in this same checkout.**
  - Do not edit `apps/server/src/db/schema.ts`, `apps/server/drizzle/*`, `apps/server/src/render/*`, `apps/server/src/jobs/*`, `apps/server/src/nodes/*` (TASK-118), or `apps/server/src/auth/*` and `apps/web/src/features/{team,account,audit}` (TASK-116).
  - If you must touch a shared file (`assistant/tools.ts`, `apps/mcp/src/tools.ts`, `routePermissions.ts`, `package.json`), re-read it right before editing, make an append-only change, and list it in the report.
  - Run tests per file while they run; flaky timeouts under load are known. Rerun the failing file alone before you call it a failure.
- Agents get no tool to activate, promote or export skills.
- Skills never contain secrets, emails, OAuth steps that need tokens, or instructions to edit code. Operator agents operate the app; code changes go to `PROPOSALS_AND_BUGS.md` or a guide.
- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`. A skill may name it only in a "do not touch" line.

## Done

- [ ] 11 new `video-*` skills + hub in `.agents/skills/`, all valid; `.cursor/skills/dieu-khien-app` is a pointer; one line in `AGENTS.md`
- [ ] `agentSkillPack.test.ts` green, with `USER_ONLY_AREAS` and `UNCOVERED_TOOLS` lists that each carry a reason
- [ ] `propose_skill` in the registry (+ MCP), with tests; drafts show source, caller and reason; no activation path for agents
- [ ] `npm run export-skills` (dry run by default, `--write` to write), `planSkillExport` tested
- [ ] user guide section + changelog
- [ ] root typecheck, server/web/mcp suites, drizzle "No schema changes"
- [ ] report `docs/tasks/TASK-124.report.md`: which skills, which tools left uncovered and why, which shared files were touched, anything Hermes-specific the user should know; then create `docs/tasks/TASK-124.done`
