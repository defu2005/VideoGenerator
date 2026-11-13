# TASK-064 — Cursor guide (skill-run reports, verification, and several agents in several environments)

**Scope:**
- every run of a channel skill leaves a report: what was done, why, the hypothesis, the metrics and the check date;
- the app checks those reports when they fall due and shows which approaches work;
- several agents of different kinds (built-in operator, Hermes, Codex, Cursor, Claude, others), in different environments, can run the same channels without stepping on each other.

Nothing here edits skills automatically, and nothing changes tool permissions.

Read `docs/cursor/README.md` first. Tests never use the network or real LLM CLIs. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

No new npm dependencies. New tables: run `npx drizzle-kit generate` in `apps/server`; never hand-write migrations.

**Order:** after TASK-063 (it uses `read_skill`, the repo skill loader and the parser). If TASK-059 (autopilot) has landed, also do section 6b. If not, write it down in the report as a follow-up.

## Why

The user asked for two things:

1. **Reports for every channel approach.** Every way of running a channel must leave a report, so the approach can be checked and improved.
2. **Several environments and agent kinds.** The user may run several environments (for example a home PC, a VPS, a cloud session), each with a different agent. The app must handle that.

Today:

- `operator_tool_audit` records `source` (assistant, mcp, operator) and the run. It does not record **which agent** or **which environment** made a call. The MCP server only sends `x-vg-tool-source` (`apps/mcp/src/apiClient.ts`).
- `operator_runs` and `operator_routing_log` cover the built-in operator only. External agents leave no run record, and nothing stores a hypothesis, a metric or a check date.
- `title_experiments` (TASK-035) is the only experiment that gets verified, and it covers titles only.
- Two agents can work on the same profile at the same time (for example both build next week's plan). Nothing stops them, and nobody can see that it happened.
- When environments use **separate app instances** (separate databases), reports from one never reach the other.

The repo skill `.agents/skills/video-bao-cao-thu-nghiem/SKILL.md` (loaded by TASK-063) already tells agents what to do: read old reports and claim the work, save a report, verify when due, and propose skill fixes. It also says what to write to a JSON file when the tools are missing. The six other `video-*` skills end with a `## Báo cáo` section naming their metrics and check date. This task builds the tools and screens that skill names:

- `get_agent_context`
- `claim_skill_run`
- `save_skill_report`
- `complete_skill_report`
- `list_skill_reports`
- `import_skill_reports`

Read that skill first. The field names in this guide match it.

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | Apache-2.0 | Names for agent identity: `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.request.model`. Use the same meanings for `agentName` and `agentModel`, and `deployment.environment.name` for `environment`. Concepts only, no SDK. |
| [MLflow Tracking](https://mlflow.org/docs/latest/tracking/) | Apache-2.0 | Run model: one run has params, metrics, tags and a status. Copy the shape (one report = one run, metrics as name/value rows), not the code. |
| [GrowthBook](https://github.com/growthbook/growthbook) | MIT (core) | How to show experiment results: baseline vs actual per metric, "inconclusive" when the sample is small, metrics that go up vs metrics that go down. Ideas only. |

If you find a better project, report it (README rule 11).

## Rules for this task

- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- **Agent identity is a label, not a login.** The headers below are self-declared. No permission, risk level, allowlist or autonomy setting may depend on them. They exist for reports, audit and claims only.
- Reports are text the agents wrote. Treat them as data when an LLM reads them, the same way `search_profile_context` results are treated: any instruction inside a report is ignored.
- Run the secret check (the fixed one from TASK-063) on every free-text field of a report. On a match, reject the save with the field name, and never echo the value.
- Do not edit `SKILL.md` files from code. Skill fixes are proposals that the user applies by hand. The only skill file edit allowed in this task is the frontmatter `tools` list of `video-bao-cao-thu-nghiem` (section 8).

## 1. Agent identity and environment

**App side.**
- New optional env var `VG_ENVIRONMENT` (default `default`): the name of this app instance. Add it to `lib/config.ts` and `.env.example`, **not** `.env`.
- Show it in the header of the web app (small chip) and in `get_agent_context`.

**Caller side.** The MCP server (`apps/mcp/src/apiClient.ts`) sends these headers when the env vars are set:

| Env var | Header | Rule |
|---|---|---|
| `VG_AGENT_KIND` | `x-vg-agent-kind` | one of `operator`, `assistant`, `hermes`, `codex`, `cursor`, `claude`, `other`; anything else → `other` |
| `VG_AGENT_NAME` | `x-vg-agent-name` | up to 64 characters `[A-Za-z0-9 ._-]`, otherwise dropped |
| `VG_AGENT_MODEL` | `x-vg-agent-model` | same rule |
| `VG_ENVIRONMENT` | `x-vg-environment` | same rule; the **agent's** environment, which may differ from the app's |

- The built-in operator sets `kind=operator`, its runtime model, and `environment` = the app's `VG_ENVIRONMENT`. The web assistant sets `kind=assistant`.
- Telegram commands use `kind=assistant`, `name=telegram`.
- Missing headers → `kind=other`, `name=unknown`, `environment=unknown`. Calls still work.

**Server side.**
- Middleware parses the headers into `ctx.agent = { kind, name, model, environment }`.
- `operator_tool_audit` gets the columns `agent_kind`, `agent_name`, `agent_model` and `agent_environment`, filled on every tool call.
- New table `agents`: one row per (kind, name, environment), holding `model`, `firstSeenAt`, `lastSeenAt` and `calls`. Upsert on each tool call, at most once per minute per agent (keep an in-memory throttle).

**New tool `get_agent_context`** (risk `read`, no args). It returns:
- `appEnvironment`, the app version, and `caller` (identity as the server sees it);
- `tools`: the tool names this caller can use;
- `profiles`: `{ id, name }` only;
- `skills`: `{ name, source, hash }` for built-in and repo skills;
- `reportTools: true`;
- `activeClaims`: the open claims, with no other data.

Agents call it first, to confirm which app they are connected to and what they can do.

## 2. Skill hash

- `skillHash(markdown)`: the first 8 hex characters of sha256 of the markdown with `\r\n` → `\n`. Repo skills hash the file. Built-ins hash `renderSkillMarkdown(skill)`. User skills hash their active version.
- `read_skill` (TASK-063) and `find_skills` hits return `hash`.
- A report whose `skillHash` does not match any known version is still stored. The UI shows "phiên bản skill khác". Different environments may have different checkouts.

## 3. Claims (no double work)

New table `skill_claims`. Columns:
- `id`, `skill`, `profileId` (nullable, for skills without a profile);
- `agentKind`, `agentName`, `agentEnvironment`;
- `claimedAt`, `expiresAt`, `releasedAt`, `reportId`.

**`claim_skill_run`** (risk `safe`), args `{ skill, profileId? }`:
- an open claim (not released, not expired) by **another** agent → return `{ ok: false, heldBy: { kind, name, environment, claimedAt, expiresAt } }`;
- the same agent → extend it and return the same claim;
- otherwise create one with `expiresAt` = now + 2 hours, and return `{ ok: true, claimId }`;
- do it in one SQLite transaction, so two calls at the same moment cannot both win (test it).

Other rules:
- `save_skill_report` with a `claimId` releases the claim and links the report.
- The web page has "Giải phóng" (release) for a stuck claim. It is a user action, not a tool.
- Claims only coordinate agents that use **the same app**. For separate apps, see section 7.

## 4. Reports

New table `skill_reports`:

| Column | Notes |
|---|---|
| `id`, `createdAt`, `updatedAt` | |
| `skill`, `skillHash` | |
| `profileId` (nullable, FK set null), `profileName` | the name is kept for imports from other apps |
| `subjects` json | `{ projectIds, publicationIds, topicIds }`, the videos and topics the metrics are measured on |
| `agentKind`, `agentName`, `agentModel`, `agentEnvironment`, `appEnvironment` | `appEnvironment` is the app that stored the report |
| `startedAt` | |
| `status` | `done`, `partial`, `blocked`, `failed`, `proposal` |
| `inputs`, `decision`, `hypothesis`, `notes`, `lesson` | text, each up to 4,000 characters |
| `actions` json | `[{ tool, result: "pending_action" \| "done" \| "blocked", ref? }]`, up to 50 |
| `metrics` json | `[{ name, baseline, target, actual, direction }]`, up to 12 |
| `checkAt` | date |
| `verdict` | `dung`, `sai`, `chua_ro` or null |
| `verdictSource` | `auto`, `agent` or `user` |
| `checkedAt`, `checkedByKind`, `checkedByName` | |
| `runId` (nullable) | operator run |
| `claimId` (nullable) | |
| `source` | `tool`, `import` or `operator_auto` |
| `importKey` (unique) | sha256 of `skill + profileName + agentName + agentEnvironment + startedAt` |

Indexes: (profileId, skill, createdAt), (checkAt, verdict), (agentKind, agentEnvironment).

**Metric catalog** (`apps/server/src/reports/metricCatalog.ts`). It maps a metric name to code that reads the value from app data for the report's `subjects` and window, and to its `direction` (`up` is better or `down` is better):

| Name | Direction | Source |
|---|---|---|
| `retention_30s` | up | per-video analytics, if the platform gives it |
| `avg_view_pct` | up | |
| `views_7d`, `views_28d` | up | |
| `subs_gained` | up | |
| `watch_hours` | up | |
| `shorts_viewed_pct` | up | viewed vs swiped |
| `rpm`, `revenue` | up | finance |
| `policy_warnings` | down | |
| `published_count` | up | |
| `blocked_count` | down | |
| `quota_used` | down | |
| `topics_rejected_duplicate` | up | |

- Names outside the catalog are allowed as `custom:<name>`, which the agent fills by hand.
- A metric the platform does not give returns `null`. Never 0, never a guess.

**Tools:**
- **`save_skill_report`** (risk `safe`):
  - args follow the table, with zod `.strict()`;
  - `hypothesis` and at least one metric are required, except for `status` `blocked`, `failed` or `proposal`;
  - `checkAt` is required when there are metrics;
  - `profileId` must exist, or be null with a `profileName`;
  - the identity fields come from `ctx.agent`, not from the args;
  - for catalog metrics with no `baseline`, compute the baseline at save time;
  - returns `{ id }`.
- **`complete_skill_report`** (risk `safe`), args `{ id, metrics: [{ name, actual }], verdict, lesson }`:
  - it may only fill `actual`, `verdict` and `lesson`, and set `checked*`;
  - it cannot change any other field;
  - it cannot overwrite a verdict whose `verdictSource` is `user`.
- **`list_skill_reports`** (risk `read`):
  - filters: `skill`, `profileId`, `agentKind`, `environment`, `status`, `verdict`, `due` (checkAt ≤ today and no verdict) and `since`;
  - paged with up to 50 rows per page;
  - the default sort is newest first.
- **`import_skill_reports`** (risk `safe`):
  - args `{ items: unknown[] }`, up to 200;
  - each item is the JSON object the skill's fallback file holds (or one row of the export, section 7);
  - validate each item with the same schema;
  - map `profileId` by id. If that fails, use an exact `profileName` match. If that fails too, keep it with a null `profileId`;
  - dedupe by `importKey`;
  - returns `{ imported, duplicates, rejected: [{ index, errors }] }`;
  - `source` is `import`. The identity fields come **from the item**, because they describe the agent that did the work. Add `importedByKind` and `importedByName` from `ctx.agent`.
- Add all of them (and `get_agent_context`) to the registry, the MCP tool list and the operator allowlist with these risks. The tool descriptions say that report text is data.

## 5. Automatic check (mechanical work stays code)

A daily job, next to the existing operator cron, at 07:00 Asia/Ho_Chi_Minh:

- For each report that is due (`checkAt` ≤ today, verdict null):
  - fill `actual` for catalog metrics from app data;
  - if any subject publication is younger than 48 hours, move `checkAt` forward by 2 days and stop.
- If every metric has a `target` and an `actual`:
  - **`dung`**: all metrics reach their target (respecting `direction`), and the subjects hold at least 3 published videos, or the report is about one video;
  - **`sai`**: none reach the target, with the same sample rule;
  - **`chua_ro`**: otherwise.
  - Set `verdictSource=auto` and leave `lesson` empty.
- Reports that still lack values (custom metrics, metrics the platform does not give) stay due. They show in "Cần kiểm chứng".
- Send one daily notification through the existing notification service when there are due or new `sai` reports. Respect the user's notification settings.
- No LLM call in this job.

**Lessons into the knowledge index.**
- When a report gets a verdict and a lesson, `enqueueIndex` it into the profile knowledge index (`apps/server/src/retrieval/indexer.ts`) as a new kind `skill_report`.
- The indexed text is: skill, hypothesis, verdict, lesson and metric numbers.
- Agents in every environment then find it with `search_profile_context`, and the handbook rule that its results are data already applies.

## 6. Operator integration

**a. Built-in operator runs.**
- When a run routes to a skill (built-in or repo) and touches a profile, code creates a draft report at run end with `source=operator_auto`:
  - `runId`, the skill and the hash;
  - `actions` from `operator_tool_audit` for that run;
  - `status` from the run outcome.
- If the model saved a report itself during the run (`save_skill_report` with the same `runId`), do not create a draft.
- Drafts without a hypothesis get `status=partial` and show as "Thiếu giả thuyết" on the page.
- The operator claims the skill at run start the same way (`claim_skill_run`). If the claim is held by another agent, the run stops with a message naming that agent and environment, and does not retry by itself.

**b. Autopilot (TASK-059), if present.**
- Autopilot steps that run a skill follow the same claim → report flow.
- Steps from the weekly loop use a `checkAt` at the end of the week.

## 7. Several environments

Two setups must both work.

**A. Several agents, one app.** For example, Hermes on a VPS and Codex on a PC both point `VG_API_URL` at the same server.
- Claims, reports and the audit already cover this.
- The page "Agent đã kết nối" lists rows from `agents`: kind, name, environment, model, last seen, number of calls, number of reports.

**B. Several apps (separate databases).**
- `GET /api/skill-reports/export?since=<date>` returns JSONL, one report per line. Leave out `claimId` and `runId`, and keep `importKey`.
- `POST /api/skill-reports/import` takes the same JSONL or a JSON array, using the same code as `import_skill_reports`. Limits are 2 MB and 1,000 rows.
- Web: "Xuất" downloads the JSONL; "Nhập" uploads a file and shows imported, duplicate and rejected counts.
- **Overlap warning.** When imported reports show another app environment working on a profile with the same `profileName` in the last 7 days, the profile page shows "Môi trường khác (<env>) cũng đang vận hành hồ sơ này". Claims cannot protect separate apps, so the user must decide.

**Agents without app tools** (file access only):
- they write the JSON file described in the report skill to `reports/skill-runs/` in their own working folder;
- add `reports/skill-runs/` to `.gitignore`;
- the user imports those files from the page, or an agent with tools calls `import_skill_reports`.

**Setup docs.** User guide page "Nhiều môi trường và nhiều agent" with a table showing how to set `VG_API_URL`, `VG_AGENT_KIND`, `VG_AGENT_NAME`, `VG_AGENT_MODEL` and `VG_ENVIRONMENT` for each agent:
- Hermes;
- Codex (`mcp_servers.<name>.env` in its config);
- Cursor (`env` in `mcp.json`);
- Claude Code (`env` in `.mcp.json`);
- the built-in operator (automatic).

Give examples with placeholder values only, and no keys. Do not edit any real agent config file in this task.

## 8. Report skill frontmatter

In `.agents/skills/video-bao-cao-thu-nghiem/SKILL.md`, add these to the frontmatter `tools` list, and change nothing else in the file:
- `get_agent_context`
- `claim_skill_run`
- `save_skill_report`
- `complete_skill_report`
- `list_skill_reports`
- `import_skill_reports`

Keep `risk: read`, because the skill's own risk is a label (TASK-063). The TASK-063 real-files test must still pass.

## 9. Web UI

New page **"Báo cáo thử nghiệm"** in the analytics group of the sidebar, with tabs:

1. **Tất cả.** A table with date, skill, profile, agent (kind and name), environment, status, hypothesis (one line), verdict and check date. Filters for each column. A row opens the detail view: all fields, metrics as baseline → target → actual with a colour for each direction, the actions with links to pending actions, projects and publications, the claim, and the run.
2. **Cần kiểm chứng.** Due reports. Per metric, the user can enter `actual` for custom metrics, then pick a verdict and write a lesson. This sets `verdictSource=user`.
3. **Theo skill.** One card per skill and hash, with:
   - runs, `dung` / `sai` / `chua_ro` counts and the success rate;
   - a breakdown by agent kind and by environment;
   - the last 5 lessons;
   - "Nên xem lại skill" when there are 3 or more `sai` in 90 days on the same hash, with links to those reports and to `proposal` reports.
   This tab never edits the skill.
4. **Agent.** The agent list from section 7A, plus open claims with "Giải phóng".

Also:
- the import and export buttons (section 7B);
- a dashboard card "Báo cáo cần kiểm chứng: N";
- the environment chip in the header.

API under `/api/skill-reports` and `/api/agents`. All rows are read-only except the user verdict, the claim release and the import.

## 10. Tests

All tests run with no network.

- **Identity:**
  - headers are parsed and bad values are cleaned up;
  - missing headers give `other` / `unknown`;
  - the audit row has the identity;
  - `agents` is upserted at most once per minute;
  - **no permission changes with identity**: the same tool call gets the same decision with `kind=operator` and with `kind=other` (table-driven over every risk level).
- **Hash:** CRLF and LF give the same hash; `read_skill` returns it.
- **Claims:**
  - a second agent gets `heldBy`;
  - the same agent extends its claim;
  - an expired claim can be taken;
  - two claims made at the same time in one transaction → one wins;
  - saving a report releases the claim.
- **Reports:**
  - required fields per status;
  - the secret check rejects a field (and the error names the field, not the value);
  - identity comes from `ctx`, not from args;
  - the baseline is computed for catalog metrics;
  - `complete_skill_report` cannot change other fields and cannot overwrite a user verdict.
- **Import:**
  - valid items, duplicates (same `importKey`) and rejected items with indexes;
  - `profileName` mapping;
  - an export → import round trip into a second in-memory DB gives equal rows.
- **Auto check:**
  - `dung`, `sai` and `chua_ro` cases;
  - a metric with `direction: down`;
  - a video younger than 48 hours moves `checkAt`;
  - a sample of fewer than 3 videos gives `chua_ro`;
  - a metric missing from the platform stays `null` and the report stays due;
  - no LLM provider is called (spy).
- **Index:** a verdict with a lesson enqueues a `skill_report` index item, and `search_profile_context` finds it.
- **Operator:**
  - a routed run without a model report creates an `operator_auto` draft with actions from the audit;
  - with a model report, no draft;
  - a run stops when another agent holds the claim.
- **MCP:**
  - the new tools are listed;
  - the headers are sent when the env vars are set and not sent when they are unset.
- **Real skill files:** `video-bao-cao-thu-nghiem` still validates with the new tools.
- **Web:** the four tabs render; the user verdict saves; the overlap warning shows from imported data.

## 11. Live check

Use mocked or free providers only, and no real keys or OAuth.

1. Set `VG_ENVIRONMENT=may-nha` on the API.
2. Start two MCP servers with different `VG_AGENT_KIND`, `VG_AGENT_NAME` and `VG_ENVIRONMENT` (for example `codex/codex-pc/may-nha` and `hermes/hermes-vps/vps-1`). Both call `get_agent_context`, and both rows show on the "Agent" tab.
3. The first agent calls `claim_skill_run` for `video-lich-san-xuat` on a test profile. The second agent gets `heldBy` naming the first.
4. The first agent saves a report with a hypothesis, `published_count` and a `checkAt` of today. Run the daily job by hand: the report gets `actual` and a verdict, or stays due with the reason.
5. Export, then import into a second app started with its own temp DB and `VG_ENVIRONMENT=vps-1`. The rows match, and the overlap warning shows on the profile with the same name.
6. Import a fallback JSON file that an agent with no tools wrote (by hand is fine).

Record the steps and screenshots in `docs/tasks/TASK-064.report.md`.

## 12. User guide

- New page "Báo cáo thử nghiệm": why every approach needs a report, the report fields, verdicts, the daily check, how to read the "Theo skill" tab, and that skill fixes are done by hand.
- New page "Nhiều môi trường và nhiều agent" (section 7): one app vs several apps, claims, the overlap warning, setup for each agent, and the fallback file.
- Safety page: identity is a label, not a permission.
- `featureMap` entries for the page, the tools and the routes; a line in `nhat-ky-thay-doi.md`.

## Done

- [ ] Every tool call records agent kind, name, model and environment; the app has `VG_ENVIRONMENT`; `get_agent_context` works.
- [ ] Claims stop two agents on one app from running the same skill on the same profile.
- [ ] Reports save, complete, list and import, with validation and the secret check; the identity comes from the caller.
- [ ] The daily job fills metrics and verdicts by code, with no LLM; lessons go into the profile knowledge index.
- [ ] Operator runs claim skills and always leave a report or a draft.
- [ ] Export and import work between two app instances, and the overlap warning shows.
- [ ] The report skill frontmatter lists the new tools and still validates.
- [ ] No permission depends on agent identity (tested).
- [ ] Migration made with `drizzle-kit generate`; all workspaces' tests and typecheck pass; live check in the report; user guide updated.
- [ ] No commit, no push; no edits to `.env`, `.claude/`, `data/`, `scripts/`, or skill files other than section 8; no new dependencies.
