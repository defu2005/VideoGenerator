# TASK-047: Cursor guide (Cursor operator: a long-lived Cursor agent session runs the app from the user's chat)

Before you start, read `docs/cursor/README.md`, `TASK-032` (the assistant), the MCP app (`apps/mcp`), TASK-044, 045 and 048 (the feature map and the user guide).

**Order.** This task comes **before** TASK-046 (provider intelligence). TASK-046 adds its tools to the registry you build here, and the operator then runs that research periodically or when the user asks. Build the registry, the standing-order storage and the tick so that a later task can add tools, handbook sections and seeded standing orders without changing this runtime. Concretely:
- the feature map, the duty list and the seeded standing orders come from arrays that other modules extend;
- standing orders have an `enabled` flag, a schedule (cron text) and a prompt;
- a code job may **wake the operator** with a short prompt (`wakeOperator(reason, prompt)`), subject to the same queue, kill switch and `maxRunsPerDay`.

No new npm dependencies are allowed.

Tests must never spawn the real Cursor CLI or use the network. Mock the spawn and use fixture stream-json lines instead.

## Why

The user wants to be the person who only hands out work.

- They chat on the web or on Telegram, for example "tuần này làm 3 video về lịch sử Việt Nam, đăng YouTube tối thứ 3/5/7" or "sao video hôm qua ít view vậy?".
- One long-lived **Cursor agent session** knows every feature of the app. It plans, operates the app, and reports back.

Today, the built-in assistant (TASK-032) does single tool calls, and AUTO mode follows fixed rules. The operator adds multi-step judgment on top of those, while every action still goes through the app's own services and guards.

The operator **runs** the app. It never edits code, never edits app config files, and never touches the database directly.

## 1. One tool registry for every surface

- **Single source of truth.** Move the TASK-032 assistant tools (`apps/server/src/assistant/tools.ts`, about 58 tools, each with a risk level `read` / `confirm`) into one registry. The assistant, MCP and the operator all use it.
- **MCP exposure.** `apps/mcp` exposes every registry tool through the server's HTTP API. Keep the existing MCP tools working.
- **Fail closed.** Each tool keeps its risk level. A tool without a risk level is treated as `confirm`.
- **Confirmation is enforced on the server, not in the prompt.** A `confirm` tool called from MCP or from the operator does not run. Instead it creates a **pending action**, reusing the TASK-032 pending mechanism, and returns `{ pendingActionId, summaryVi }`.
  - Only the user can approve a pending action: a web button, a Telegram inline button, or the user's own chat message "duyệt <id>".
  - There is **no MCP or operator tool that approves pending actions**. Add a test for this.
- **Hard blocks inside the registry** apply to every caller:
  - Project `56374fb2-54cf-48ff-9441-2e6c653295d4` is refused.
  - No tool may change credentials, add payment, raise spending limits, or enable paid fallback.
  - No tool may enable profile automation or a public upload without a pending action.
  - Tag each tool `source: "assistant" | "mcp" | "operator"` in the audit log.

## 2. The operator runtime (`apps/server/src/operator/`)

### Binary

- Use the Cursor CLI from settings: `operator.cursorPath`.
- Auto-detect the newest `%LOCALAPPDATA%/cursor-agent/versions/*/index.js` and run it with the bundled `node.exe`.
- Show the detected version in the UI.
- Do not install or update Cursor.
- Do not handle Cursor credentials. The CLI uses the user's existing Cursor login. If the CLI reports that it is not logged in, show "Mở terminal và chạy `cursor-agent login`" and stop.

### Workspace

- Create a dedicated folder outside the repo: `<app data dir>/operator/`. Use the same base as other app data. Never use the repo folder.
- The app (re)writes these files in it at startup and whenever settings change:
  - `AGENTS.md`: the operator handbook (§3).
  - `.cursor/mcp.json`: one server, `video-agent`, pointing at the app's MCP entry (`apps/mcp` built output) with the local API URL.
  - `.cursor/cli.json`: the permissions:
    - **deny** `Shell(*)`;
    - **deny** writes everywhere except `notes/**`;
    - **allow** `Read(**)` inside the workspace only;
    - **allow** the `video-agent` MCP tools.
  - `notes/`: the operator's own memory: the standing orders summary, decisions and lessons, written as Markdown. This is the only place it can write.
- Check the exact permission syntax against the installed CLI version's docs (`cursor-agent --help`, and the CLI docs it links). If a deny rule cannot be expressed, add an equivalent check and document it.

### Running

Each user message or scheduled tick spawns:

```
node index.js -p --output-format stream-json --stream-partial-output --trust --approve-mcps --workspace <operator dir> [--resume <chatId>] [--model <operator.model>] "<message>"
```

- **No `--force`/`--yolo`.** The permissions file decides. Any shell or edit attempt is denied and logged.
- **Session continuity.** Store the Cursor `chatId` from the init event per operator conversation and pass `--resume` next time, so the session keeps its context. Cursor summarises context on its own when it fills up.
  - Add a "Phiên mới" button that starts a fresh chat. The `notes/` folder carries memory across sessions.
- **One run at a time.** Further messages are queued (FIFO) and shown as "đang chờ".
- **Timeout.** Use 15 min per run (configurable). Kill the process tree on timeout or on "Dừng".
- **Parse stream-json:**
  - assistant text deltas go to the chat as they stream;
  - tool calls are shown as compact chips ("đang gọi: list_projects");
  - the final `result` is the answer;
  - store everything in the operator conversation tables.
- **Redaction.** Run the TASK-045/046 redaction over all stored and displayed text.
- **Kill switch.** Add a "Tắt operator" setting. When it is on, no spawns happen at all.

## 3. The handbook (`AGENTS.md` written into the operator workspace)

Generate it from code so it never goes stale.

- **Role.** "Bạn là người vận hành ứng dụng Video Agent cho người dùng. Chỉ thao tác qua công cụ MCP `video-agent`. Không sửa code, không chạy lệnh shell."
- **Feature map.** One short paragraph per feature area, generated from `featureMap` (TASK-048, `@vg/shared`). The operator also answers "how do I…?" questions with `search_user_guide`, which points to `docs/user-guide/`. The areas are:
  - profiles, guideline packs, topics and the trend queue;
  - projects and pipeline stages, gates and modes (MANUAL/ASSISTED/AUTO);
  - review chat, renders, clips, translations;
  - publishing and schedule slots, comments inbox;
  - analytics, insights and finance;
  - LLM routes and quota (the provider intel section is added by TASK-046);
  - budget modes;
  - notifications.
- **Tools.** The tool list with risk levels, generated from the registry.
- **Rules.**
  - Every `confirm` action becomes a pending action that the user approves. Never tell the user that something was done while it is still pending.
  - Never touch project `56374fb2-…`.
  - No paid spending, no credentials.
  - Follow the profile guidelines.
  - Prefer free models and quota left.
  - Report the costs from the usage tools.
- **How to work.**
  1. Read `notes/` first.
  2. Plan briefly.
  3. Act with tools.
  4. Verify the state with read tools.
  5. Answer in Vietnamese with what was done, what is pending approval, and what comes next.
  6. Append decisions to `notes/journal.md`. Keep `notes/standing-orders.md` up to date.
- **Duties.** A list of recurring duties that modules register. TASK-046 will register the provider research procedure: fetch official pages, submit quote-verified assessments, never guess, write `UNKNOWN`, and propose but never apply routing.
- **Current state snapshot.** Profiles, active automation, pending gates, and quota status, refreshed at each generation.

## 3b. Smart orchestration (ideas from agent-skill-router and agentopt)

The registry has many tools and the handbook will keep growing, so do not load everything into every run. Build these mechanisms natively in TypeScript, with no new dependencies. Take ideas only; do not copy code.

The ideas come from two projects, `paulpas/agent-skill-router` (MIT) and `AgentOptimizer/agentopt` (Apache-2.0). Read-only clones are at `C:/Users/defu/AppData/Local/Temp/claude/b5570a7e047086c0/df5792f6-39a7-4316-9c4d-dc8485eca8c4/scratchpad/research/`. **Read them only; never run, install or build anything from them.** Credit both projects in the report.

### 1. Operator skills (load on demand)

- **Generate the skills.** Write `skills/<area>/<topic>.md` into the operator workspace from code, as small procedures. Each file has frontmatter:
  - `name`, a one-line `description`;
  - `triggers` (Vietnamese and English keywords);
  - `antiTriggers` (words that mean the skill is wrong, for example "xoá" for a read-only report skill);
  - `tools` (the registry tools it uses), `risk`.
- **Examples:** publish a project, prepare a weekly plan from standing orders, answer a quota question, triage comments, research a provider (TASK-046 adds it), compare models (§7b of TASK-046).
- **Handbook.** `AGENTS.md` keeps the role, the rules and a skills **index** (name + description). It does not hold the full skill bodies. The handbook tells the operator to call `find_skills` first, then read only the top 1–3 skill files.
- **Validation.** A test checks every generated skill: valid frontmatter, its `tools` exist in the registry, no secrets, no stub text ("TODO", "…").

### 2. Hybrid routing for skills and tools (pure, tested, in `operator/routing.ts`)

- **`find_skills(query)` and `find_tools(query)`**, read tools in the registry. Score each candidate as a weighted sum:

  | Signal | Weight |
  |---|---|
  | BM25 over name, description and body (Vietnamese diacritics folded) | 0.45 |
  | trigger match | 0.25 |
  | historical success (§4) | 0.15 |
  | area match from a simple intent classifier (keywords → feature area from `featureMap`) | 0.15 |

  An anti-trigger hit subtracts 0.3.
- **Diversify** the top results (MMR: drop a result that is too similar to one already picked), so the top 3 are not three near-copies.
- **Compound requests.** Split "đăng video A rồi báo cáo quota" on Vietnamese and English conjunctions, and route each part.
- **Explanation.** Each result carries a per-signal score breakdown.
- **Tool exposure.** The MCP server still serves every tool. The routing only changes what the handbook recommends and what the operator reads. If the CLI supports filtering MCP tools per run, use it for the top tools plus all read tools; otherwise document that it is not supported.

### 3. Context economy

- **Compressed skill bodies.** Each skill has a short form (steps only) and a long form (with examples and edge cases). `find_skills` returns the short form. The operator reads the long form only when it needs it.
- **Snapshot size.** The current-state snapshot in `AGENTS.md` stays under a size budget (setting `operator.snapshotMaxChars`, default 6,000). Longer lists are summarised with counts plus "dùng công cụ X để xem đủ".
- **Reasoning depth by risk.** The handbook says to act directly on read-only and mechanical requests. It says to plan and verify explicitly for anything that changes state, spends quota, or touches publishing. Verification after a change is never skipped.

### 4. Learning from outcomes

- **Routing log.** Store every routing decision in the table `operator_routing_log`: the query, the candidates with their scores, what was picked, the run id and the outcome (success, failed, rejected by the user, or the pending action was rejected). Generate the table with `drizzle-kit generate`.
- **Historical success.** For each skill and tool, compute the success rate over the last 30 days (Laplace smoothing; a new skill starts at 0.5). It feeds the 0.15 weight in §2.
- **Lessons.** After a failed or rejected run, the operator appends one line to `notes/lessons.md`. The handbook tells it to read lessons that match the current skill.
- **Skill proposals.** When the same multi-step request succeeds three or more times without a matching skill, the operator may write a draft to `notes/skill-proposals/`. Drafts never load on their own. The user promotes a draft on the operator page, and the app validates it like a generated skill.

### 5. Model choice per step (links to TASK-046 §7b)

- **Per-run model.** Pick the Cursor `--model` per run from settings: `operator.modelByKind` = { chat, tick, research, eval }. Only models that the user's Cursor plan allows are offered. Read the list from `cursor-agent --list-models` if available; otherwise use a manual list. The default is the current model for all kinds.
- **App LLM calls.** For the app's own LLM calls that the operator triggers (evals, research summaries), use the TASK-046 §7b scorecard, not a fixed model.
- **Eval budgeting (agentopt idea, for TASK-046 §7b).** When comparing K candidate models on a suite:
  - run a small warm-up on every candidate (2 cases);
  - then spend the remaining calls on the candidates that are still plausible winners;
  - drop a candidate once its upper confidence bound is below the leader's lower bound (successive elimination);
  - stop at the call cap or when the leader is clear.

  Report the calls saved against a full run.
- **Response cache.** Cache eval and judge calls by a hash of (model, messages, params). A re-run with a changed grader reuses the model outputs.

### 6. Tests for this section

- BM25 ranks an exact skill first. Trigger and anti-trigger scoring work. The weights add up. MMR drops a near-duplicate. A compound request yields two routes.
- Historical success uses smoothing and a 30-day window. A new skill scores 0.5.
- The generated skills pass validation. The handbook contains the index and not the bodies. The snapshot respects its size budget.
- Successive elimination drops a clearly worse candidate early and never drops the leader. The call cap is respected. The cache hits on an identical request.
- The routing log is written per decision with its outcome.

## 4. Standing orders and ticks (autonomy)

- **Standing orders.** The user can give standing orders in chat, for example "mỗi tuần 3 video kênh A". The operator records them in `notes/standing-orders.md` and also through a registry tool `save_standing_order` (risk `read`, since it only stores text). The app shows them in the operator page. The user can edit or delete them there.
- **Per-order schedules.** Each standing order may carry its own cron. A due order runs as its own operator run with its prompt. Seeded orders from modules start `enabled: false`.
- **Scheduled tick.** Settings: `operator.tickCron`, default **off**; suggest daily at 08:00.
  - Each tick sends the operator: "Kiểm tra trạng thái và thực hiện các lệnh thường trực."
  - It runs with the same rules. Everything risky becomes a pending action.
  - The tick result is summarised to Telegram.
- **Usage cost.** Each run uses the user's Cursor allowance.
  - Show the runs today and this month.
  - Setting `operator.maxRunsPerDay` (default 30). Over the cap, refuse with a Vietnamese message.

## 5. Chat surfaces

- **Web assistant page.** Add an engine switch: "Trợ lý tích hợp" (current) | "Cursor operator". The operator shows streaming text, tool chips, pending action cards with Approve/Reject, the queue, Dừng, and Phiên mới.
- **Telegram (a main way the user gives work).** Use the existing bot and the existing allowed chat id only. Messages from any other chat are ignored and logged.
  - **Routing.**
    - The setting `operator.telegramEngine` decides who answers plain messages. It defaults to `operator` once the operator is enabled.
    - `/op <việc>` always goes to the operator.
    - `/tl <câu hỏi>` always goes to the built-in assistant.
  - **Feedback while working.**
    - Reply at once: "Đã nhận, đang làm" (or "Đang chờ (vị trí N)" when queued).
    - Then edit that message, at most every 10 s, with the current tool chips.
    - Then send the final answer, split into chunks of at most 4,000 characters.
  - **Commands:**
    - `/status`: the current run, the queue, and runs today against the cap;
    - `/stop`: kills the current run;
    - `/new`: starts a new session;
    - `/orders`: lists the standing orders, with inline buttons to turn each one on or off. Turning an order on comes from the user's own press, so it is allowed.
  - **Pending actions** arrive as inline Duyệt/Từ chối buttons. Only the allowed chat can press them.
  - **Notifications.** Runs started by schedule or `wakeOperator` (not by the user) send their result summary to Telegram too.
  - **Off switch.** When the kill switch is on, reply "Operator đang tắt" and point to `/tl`.
- **Operator page** (`/operator`, near "Trợ lý AI"):
  - status (CLI found / logged in / version / model);
  - standing orders;
  - recent runs with duration, tool calls and outcome;
  - the audit log of operator tool calls;
  - a read-only view of the `notes/` files;
  - settings.

## 5b. Talking to the operator directly from Cursor (IDE window or terminal)

CLI sessions do not appear in the Cursor IDE window. The operator workspace is therefore built so that the user can also work with it directly.

- **IDE window.** The user opens `<app data dir>/operator/` as a folder in the Cursor IDE and chats in the normal Agent panel. That agent reads the same `AGENTS.md` and `notes/` and uses the same `video-agent` MCP server from `.cursor/mcp.json`.
  - The guards are the same, because confirm tools and blocks are enforced in the registry on the server.
  - The operator page shows an "Mở trong Cursor" button. It opens the folder with the `cursor` command if it is on PATH; otherwise it shows the path to copy.
- **Terminal.** The operator page shows the exact command to continue the current CLI session interactively, `cursor-agent --resume <chatId>` (using the full path when `cursor-agent` is not on PATH), with a copy button. The user can then type into the same session.
- **Shared memory.** Runs from the IDE, the terminal, web, and Telegram all share `notes/`. MCP tool calls coming from outside the app's own spawns are logged with `source: "mcp"` in the audit log.

## 6. Tests

**Tool registry**
- Assistant, MCP and operator all resolve to the same registry.
- A `confirm` tool from MCP or the operator creates a pending action and does not execute.
- No approve tool is reachable from MCP or the operator.
- The protected project is refused for every source.

**Workspace**
- The generated `AGENTS.md` lists every registry tool.
- `cli.json` denies Shell and writes outside `notes/`.
- `mcp.json` points at the MCP build.

**Runtime** (mocked spawn)
- The `chatId` is captured and `--resume` is passed next time.
- The queue is FIFO and runs one at a time.
- The timeout kills the run.
- The kill switch prevents any spawn.
- `maxRunsPerDay` is enforced.
- The not-logged-in output shows the login hint.
- Redaction is applied.
- `--force` is never in the args.

**Stream parser**
- Text deltas, tool chips and the final result come out correctly.
- Malformed lines are skipped.

**Ticks**
- Off by default.
- A due per-order schedule runs that order's prompt. Disabled orders never run.
- `wakeOperator` respects the kill switch, the queue and `maxRunsPerDay`.
- When on, a tick sends the standing-orders prompt.
- The Telegram summary is sent.

**Telegram**
- `/op`, `/tl` and plain-message routing work.
- Other chats are ignored.
- The ack is edited with the progress, and long answers are chunked.
- `/status`, `/stop`, `/new` and `/orders` work.
- Duyệt/Từ chối buttons work only from the allowed chat.

**Web**
- The engine switch works.
- Pending cards approve and reject.
- The queue shows.
- The operator page renders.

## 7. Live check

1. Check that the real CLI is found. Show its version.
2. Send one message in the web operator chat: "Liệt kê các hồ sơ và project đang chờ duyệt, đừng thay đổi gì." It must answer from MCP read tools only.
3. Send "Tạo project nháp về chủ đề 'thử nghiệm operator' trong hồ sơ test". This must produce a pending action, unless that tool is `read` in the registry. Approve it in the UI. Then use only test profile `e6c2f6f3-3e6f-434d-94ae-77d7f4c912f0`. Then delete the draft through the UI.
4. On Telegram, send `/op liệt kê hồ sơ, đừng thay đổi gì` and check the ack, the progress and the answer. Then send `/status`.
5. Check the audit log, the `notes/journal.md` entry, and that a shell attempt (ask "chạy lệnh dir") is refused.
6. **Do not** enable ticks. Do not publish, render or approve gates. Never touch `56374fb2-54cf-48ff-9441-2e6c653295d4`.
7. Attach screenshots.

## Done

Use the done checklist from the README. Write `docs/tasks/TASK-047.report.md` and `docs/tasks/TASK-047.done`.
