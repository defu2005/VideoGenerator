# TASK-063 — Cursor guide (load repo skills from `.agents/skills/` into the operator, find_skills and MCP)

**Scope:** the operator, `find_skills`, the handbook and MCP agents also use the channel-operating skills that live as `SKILL.md` files in the repo. The skill text is not changed by this task, and no new tool permissions are added.

Read `docs/cursor/README.md` first. Tests never use the network or real LLM CLIs. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

No new npm dependencies. No schema change, so no migration.

**Order:** can run any time after TASK-047 (the operator). It does not touch files from 059–062, except that `assistant/tools.ts` gets one new tool. If 059–062 are in progress, add the tool at the end of the list so merges stay simple.

## Why

The repo now has seven skills for running a monetised channel, written in the common `SKILL.md` format (folder per skill, YAML frontmatter, Markdown body):

| Folder | Use |
|---|---|
| `.agents/skills/video-chien-luoc-kenh/` | Niche, genre and monetisation rules (YouTube inauthentic and reused content, AI persona, TikTok over 1 minute, Facebook 10K) |
| `.agents/skills/video-chon-chu-de/` | Topic queue with a duplicate check and a "giá trị riêng" (unique value) line for each topic |
| `.agents/skills/video-giu-chan-nguoi-xem/` | Script review: first 30 seconds, re-hook every 60–90 seconds, new picture every 5–10 seconds |
| `.agents/skills/video-kiem-tra-truoc-khi-dang/` | Pre-publish checklist: repetition, reused content, AI label, copyright, watermark, length per platform |
| `.agents/skills/video-lich-san-xuat/` | Weekly cadence: long videos, Shorts cut from the channel's own videos, translations |
| `.agents/skills/video-doc-so-lieu/` | Analytics into actions; revenue and goal progress |
| `.agents/skills/video-bao-cao-thu-nghiem/` | Report for every skill run: hypothesis, metrics, check date; later verification and skill improvement; several agents and environments. Its body names the report tools that TASK-064 adds. Until then its frontmatter `tools` lists only existing read tools. |

Each of the other six skills ends with a `## Báo cáo` section that points to `video-bao-cao-thu-nghiem`.

External agents (Hermes, Codex, Cursor) can read these files directly. The built-in operator cannot:

- `writeOperatorWorkspace` (`apps/server/src/operator/workspace.ts`) only writes `OPERATOR_SKILLS` from code, plus `extraSkills`;
- `OperatorService.userSkills()` (`apps/server/src/operator/service.ts`) only reads `skills/user/*.md` in the operator workspace and active skill versions;
- `parseSkillMarkdown` (`apps/server/src/operator/skills.ts`) reads one-line frontmatter values only. The repo files use a folded YAML description (`description: >-` followed by indented lines), so today the description would be read as `>-`;
- MCP agents that cannot read the repo folder have no tool to fetch a skill's full text.

Each repo skill already has the fields the operator needs: `operator: true`, `area`, `triggers`, `antiTriggers`, `tools` and `risk`. Every tool name in `tools` exists in the registry today.

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| [Agent Skills format](https://agentskills.io/) (`SKILL.md`, used by Anthropic, Codex, Cursor and Hermes) | open spec | File layout: `<skills dir>/<name>/SKILL.md`, frontmatter with `name` and `description`, Markdown body. Extra frontmatter keys are allowed, and other agents ignore them. |
| [YAML 1.2 spec, block scalars](https://yaml.org/spec/1.2.2/#81-block-scalar-headers) | spec | Rules for `>` / `>-` (folded) and `|` / `|-` (literal). Implement only these two forms by hand in the parser; do not add a YAML library. |

If you find a better project, report it (README rule 11).

## Rules for this task

- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- **Skills are guidance, not permissions.** Loading a repo skill never adds a tool to the operator allowlist, never lowers a tool's risk, and never bypasses hard blocks or pending actions. A skill's `risk` only labels it.
- The operator and agents only **read** repo skills. No route or tool writes to `.agents/skills/`. Do not edit the skill files in this task. If a file fails validation, report it in `docs/tasks/TASK-063.report.md`.
- Do not load the other folders in `.agents/skills/` (design skills and others). Load a skill only when its frontmatter has `operator: true`.

## 1. Parser: folded and literal descriptions

In `apps/server/src/operator/skills.ts`:

- `parseSkillMarkdown` reads `description` (and any other scalar key) in these forms:
  - one line: `description: text`;
  - folded: `description: >` or `>-`, then lines indented more than the key. Join them with single spaces and trim;
  - literal: `description: |` or `|-`. Keep the newlines and trim the end.
- Add `ParsedSkill.operator: boolean` (`operator: true` in frontmatter) and `ParsedSkill.area: string` (empty when absent).
- Short body: use the `## Ngan` section when present (unchanged). Otherwise use the `## Các bước` section. Otherwise use the whole body (unchanged).
- Line endings: accept `\r\n` everywhere (the repo is used on Windows).
- **Fix a false positive in the secret check.** `/sk-[A-Za-z0-9]/` in `validateSkillMarkdown` matches ordinary words. For example, the source URL `...is-a-channel-level-risk-not-a-ban...` in `video-chien-luoc-kenh` contains "risk-not", so the check would reject that skill. Change the rule to match a real key only: `sk-` that is not preceded by a letter or digit, followed by at least 16 characters from `[A-Za-z0-9_-]`. Test both cases: a URL containing "risk-not" passes; `sk-` plus 20 random characters fails.
- Old skills in `skills/user/` and stored skill versions must parse exactly as before (test it).

## 2. Repo skill loader

New file `apps/server/src/operator/repoSkills.ts`:

```ts
export type RepoSkill = OperatorSkill & { source: "repo"; path: string; markdown: string };
export function loadRepoSkills(input: {
  root: string;                 // repo root (repoRoot() in workspace.ts)
  toolNames: ReadonlySet<string>;
  builtinNames: ReadonlySet<string>;
}): { skills: RepoSkill[]; rejected: Array<{ path: string; errors: string[] }> };
```

- Read `<root>/.agents/skills/*/SKILL.md`, one folder deep only. Skip symlinks. Skip files over 64 KB.
- Keep only files that parse and have `operator: true`.
- Validate with `validateSkillMarkdown(markdown, toolNames)`. A file with errors goes to `rejected` and is not loaded.
- The folder name must equal `name`. Otherwise reject it with "Tên thư mục khác name".
- Name clashes:
  - a built-in skill (`OPERATOR_SKILLS`) with the same name wins; reject the repo skill with "Trùng tên kỹ năng có sẵn";
  - a user skill (`skills/user/` or an active skill version) with the same name wins over the repo skill. The user may have edited a copy.
- Map to `OperatorSkill`:
  - `area` is the frontmatter `area` or `"kenh"`;
  - `topic` is `name`;
  - `shortSteps` are the short body lines with list markers removed;
  - `longNotes` is `[body]`.
- Cache by file path and `mtimeMs`, so editing a skill file takes effect on the next run without restarting the server.
- Log one warning per rejected file. The message holds the path and errors, never file contents.

## 3. Operator workspace and routing

- `OperatorService` gets `repoSkills()`, which calls `loadRepoSkills` with the registry tool names (`getToolCatalogForPrompt()`) and the built-in names.
- `writeOperatorWorkspace`:
  - writes each repo skill's **original markdown** to `skills/<area>/<name>.md`, so cursor-agent reads the full text including tables and sources;
  - passes repo skills to `renderHandbook` with the other skills. The handbook lists them under their area like any other skill.
- `skillCandidates()` includes repo skills, so `find_skills` and the routing log can pick them. Each candidate id is `repo:<name>`. Routing history works as for other skills.
- `skillEval` (`apps/server/src/operator/skillEval.ts`): repo skills count as candidates next to built-ins. The eval uses each repo skill's triggers and anti-triggers, the same way it does for user skills.
- The standing-orders text and the TASK-059 autonomy playbooks are unchanged. Repo skills are found by routing, not added to any playbook.

## 4. Read a skill from MCP and the assistant

- New registry tool `read_skill` (risk `read`) with input `{ name: string }`:
  - it returns `{ name, source: "builtin" | "repo" | "user", area, risk, tools, markdown }`;
  - for built-ins, `markdown` is `renderSkillMarkdown(skill)`;
  - unknown names return a 404 error with "Không có kỹ năng này".
- `find_skills` results include `source` for each hit, so an MCP agent knows it can call `read_skill`.
- Add `read_skill` to the MCP tool list (`apps/mcp/src/tools.ts`) and to the operator allowlist as a read tool.
- The `find_skills` and `read_skill` tool descriptions say that the skill text is guidance and that the tools it names still follow their own risk.

## 5. Web UI

On the operator page, in the skills panel (`apps/web/src/features/operator/SkillVersions.tsx`, or next to it):

- a "Kỹ năng trong repo" list with name, area, risk, number of tools and the description;
- each row opens a read-only view of the markdown;
- rejected files show in a warning box with the path and errors, plus the line "Sửa file trong .agents/skills rồi chạy lại operator".
- No edit button. Editing happens in the file. Users who want their own version copy it into `skills/user/`; the existing flow covers that.
- API: extend `GET /api/operator/skills` with `repo: Array<{ name, area, risk, tools, description }>` and `repoRejected: Array<{ path, errors }>`. Add `GET /api/operator/skills/repo/:name`, which returns the markdown.

## 6. Tests

- `skills.test.ts` (or the existing operator parser test):
  - folded `>-` and `>` descriptions parse to one line;
  - literal `|` keeps its newlines;
  - `\r\n` files parse the same as `\n` files;
  - an old one-line skill parses exactly as before;
  - the short body falls back to `## Các bước`;
  - `operator` and `area` are read.
- `repoSkills.test.ts`, with a temp folder of small skill files:
  - a skill without `operator: true` is not loaded;
  - an unknown tool → rejected;
  - a folder name different from `name` → rejected;
  - a clash with a built-in name → rejected;
  - a user skill with the same name wins;
  - an edited file (new mtime) is re-read; an unchanged one is not.
- **Real files test:** load the actual `.agents/skills/` from the repo root. All seven `video-*` skills load with no rejections, and every tool they name exists in the registry. This test keeps the skill files and the registry in sync.
- `operatorWorkspace.test.ts`: the workspace has `skills/kenh/video-lich-san-xuat.md` with the original text, and the handbook lists the seven names.
- `operatorRouting.test.ts`, through the same router `find_skills` uses:
  - "Lập lịch sản xuất tuần và cắt shorts cho kênh" → `video-lich-san-xuat` in the top 3;
  - "Nên làm kênh ngách gì để kiếm tiền" → `video-chien-luoc-kenh` in the top 3;
  - "Kiểm tra video này trước khi đăng có bị rập khuôn không" → `video-kiem-tra-truoc-khi-dang` in the top 3;
  - "Báo cáo số liệu kênh tháng này" → `video-doc-so-lieu` in the top 3;
  - "Kiểm chứng xem hướng nào hiệu quả, agent nào đã làm" → `video-bao-cao-thu-nghiem` in the top 3;
  - "Kế hoạch tuần từ lệnh thường trực" still returns the built-in `weekly-plan` in the top 3;
  - the off-topic scenarios ("thời tiết", "câu chuyện cười", "17 nhân 23") pick no repo skill.
- Tool tests:
  - `read_skill` returns a repo skill's markdown and returns built-ins;
  - an unknown name → 404;
  - `read_skill` is risk `read`, and loading repo skills does not change any other tool's risk or the allowlist (compare before and after).
- Web test: the repo list renders, and rejected files show the warning.

## 7. Live check

Use mocked or free providers only, and no real keys.

1. Start the API. Open the operator page: "Kỹ năng trong repo" shows seven skills and no warnings.
2. Ask the operator (dry run, or a run with no confirm-risk tool approved) "Lập lịch sản xuất tuần cho hồ sơ X". The routing log picks `repo:video-lich-san-xuat`, and the run reads `skills/kenh/video-lich-san-xuat.md`.
3. From MCP, call `find_skills` with "kiểm tra trước khi đăng", then `read_skill` on the hit. The full markdown comes back.
4. Add a fake tool name to a **copy** of a skill in a temp folder (not the repo file) and point a test run of the loader at it: it is rejected with the tool name.

Write what you saw in `docs/tasks/TASK-063.report.md`.

## 8. User guide

- Operator page: what repo skills are, where they live (`.agents/skills/`), that only skills with `operator: true` load, that editing the file takes effect on the next run, and that skills never add permissions.
- A short list of the seven channel skills with one line each.
- For external agents (Hermes, Codex, Cursor): they can read `.agents/skills/` directly, or call `find_skills` and `read_skill` over MCP.
- `featureMap` entries for the repo skills panel, `read_skill` and the new route; `nhat-ky-thay-doi.md` line.

## Done

- [ ] The parser reads folded and literal descriptions, `operator` and `area`; old skills parse as before.
- [ ] The seven `video-*` skills load into the operator workspace, the handbook, `find_skills` and `skillEval`, with no rejections (real files test).
- [ ] Invalid, clashing or non-operator files are not loaded; rejections show on the operator page.
- [ ] `read_skill` works from the assistant, MCP and the operator, and is read-only.
- [ ] No tool risk, allowlist or hard block changes because of skills (tested).
- [ ] All workspaces' tests and typecheck pass; live check in the report; user guide updated.
- [ ] No commit, no push, no edits to `.env`, `.claude/`, `data/`, `scripts/` or the skill files; no new dependencies.
