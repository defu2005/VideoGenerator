# TASK-032 — Cursor guide (LLM assistant that controls the app, web + Telegram)

Read `docs/cursor/README.md` and `docs/cursor/TASK-031.md` first (TASK-031 is committed). The user chats in Vietnamese with one assistant, either in a web chat panel or in the paired Telegram chat. The assistant:
- asks short clarifying questions when the request is unclear;
- then changes settings or runs actions through a fixed set of tools;
- answers questions about the app's numbers (videos, publications, costs, schedule).

No new npm dependencies.

## 1. Agent loop without native tool calling
Not every provider supports tool calls (CLI providers do not), so use structured JSON turns through `generateRoutedStructured` with a new LLM task `assistantChat`:
- Add it to `LLM_TASKS` with stage "SETTINGS", tier "fast" and a budget feature. Follow exactly how `topicSuggest` / `modelAdvisor` were added (shared schema, budget modes, mock provider answer).
- Each LLM step returns (zod-validated):
  ```ts
  { reply: string,                       // Vietnamese text for the user (may be empty while calling tools)
    clarify?: { question: string, options?: string[] },  // ask before acting
    calls?: { tool: string, args: unknown }[],           // max 4 per step
    done: boolean }
  ```
- The loop runs at most 6 steps per user message:
  - read tools run immediately, and their results (truncated to ~3000 chars each) go into the next step;
  - safe-write tools run immediately;
  - confirm tools are not run; they become pending actions (section 3).
- The loop stops when `done`, or when it asks to `clarify`, or when it creates pending actions.
- A tool name or args that fail validation go back to the LLM as an error once. After that, the loop answers with a Vietnamese error.
- The system prompt holds:
  - the tool catalog (name, description, args JSON schema, risk);
  - the current date and timezone;
  - the profile list (id, name, platforms);
  - the rule "ask when the target profile/project or a key value is ambiguous; never invent ids, look them up with tools";
  - the rule "answer in Vietnamese, short".
- Every assistant LLM call records usage like the other tasks (shows in "Mức dùng").

## 2. Tools (`apps/server/src/assistant/tools.ts`)
The tools call the existing services directly, not over HTTP. Each tool has: name, Vietnamese description, a zod args schema, a risk of `read` | `safe` | `confirm`, and `summarize(args)`, which produces a one-line Vietnamese description used on confirm buttons.

The examples below are the minimum; reuse the same operations the MCP tools in `apps/mcp/src/tools.ts` expose.

- **read:**
  - `list_profiles`, `get_profile`;
  - `list_projects`, `get_project`, `get_pipeline`;
  - `list_topics`;
  - `automation_status`;
  - `list_publications` (filter by status, profile, date range);
  - `publish_calendar` (next N days);
  - `usage_summary` (period today/7d/30d, by provider/model/profile);
  - `dashboard_stats`;
  - `get_llm_settings`;
  - `list_accounts` (connection status, never tokens);
  - `notification_settings`.
- **safe:**
  - `create_project` (does not run it);
  - `add_topic`;
  - `suggest_topics`;
  - `approve_topics` and `reject_topics`;
  - `pause_automation_all`: the kill switch. Stopping is always safe.
  - `propose_models` (model advisor propose only);
  - `update_notification_toggles`.
- **confirm:**
  - `update_profile_direction`;
  - `set_profile_automation` (enable/disable, `videosPerDay`, `publishTimes`, timezone, lead time, autoApprove, autoPublish);
  - `resume_automation_all`;
  - `run_pipeline`;
  - `approve_gate`;
  - `publish_project`;
  - `cancel_publication`;
  - `apply_models`;
  - `update_llm_settings`;
  - `delete_topic`, `delete_project`.
- Never expose tools that touch credentials, tokens, OAuth connect/disconnect, app credentials or the Telegram token. The assistant can explain how to do those in the web UI.

## 3. Confirmation and the "tự động hết" rule (user decision)
- **Default:** read and safe tools run at once. Confirm tools become pending actions, stored in a new table `assistant_pending_actions`:
  - columns: id, conversation_id, tool, args json, summary, status `pending` / `confirmed` / `rejected` / `expired` / `failed`, result, created_at, expires_at (30 min);
  - the assistant's reply lists them, and the user confirms each one or all of them.
  - **Web:** buttons "Xác nhận" / "Bỏ qua" per action, plus "Xác nhận tất cả".
  - **Telegram:** inline buttons with callback data `pa:<id>:y` / `pa:<id>:n` / `pa:all:<conversationId>:y`, verified against the paired chat. After a press, edit the message to remove the buttons and reply with the result.
  - Re-validate args before running. Run each action once only (an atomic status update guards against double presses).
- **Full-auto mode:** the user wants no waiting when they ask for everything automatic. Add an assistant setting `confirmMode: "risky" | "auto"` (default "risky"), switchable in the web UI. In addition, when the user explicitly says in the current message to do everything without asking (e.g. "tự động hết", "làm luôn không cần hỏi"), the LLM sets `autoConfirm: true` on that step. Under either:
  - confirm tools run at once, without notifying and waiting;
  - the reply reports what was done.
  - **Exception:** `delete_project` and `delete_topic` always need confirmation, because deletion cannot be undone. Tell the user why in one line.
- When automation is enabled through the assistant in full-auto, the resulting projects run in AUTO with `autoPublish` per the profile. Per TASK-031, they then send no "chờ duyệt" notifications.

## 4. Conversations
- Tables `assistant_conversations` (id, channel `web` | `telegram`, title, created_at, updated_at) and `assistant_messages` (id, conversation_id, role user/assistant/tool, content json, created_at). Generate the migrations.
- Send the last 20 messages plus a running short summary as context. Tool results stored in history are truncated.
- Telegram uses one rolling conversation; the command `/new` starts a fresh one.
- API, routes in `apps/server/src/api/assistant.ts`:
  - `GET /api/assistant/conversations`, `POST /api/assistant/conversations`;
  - `GET /api/assistant/conversations/:id/messages`;
  - `POST /api/assistant/conversations/:id/messages` with `{ text }`, which returns the new messages and the pending actions;
  - `POST /api/assistant/actions/:id/confirm`, `POST /api/assistant/actions/:id/reject`;
  - `GET /api/assistant/settings`, `PUT /api/assistant/settings`.
- One message at a time per conversation; a second request while one is running returns 409.

## 5. Telegram wiring
Replace the TASK-031 placeholder handler:
- text from the paired chat → assistant (show the "typing" chat action while working);
- button presses → confirm/reject;
- keep `/status`, `/help`; add `/new` and `/pause` (kill switch, no LLM).

Notifications from TASK-031 that offer an action can carry buttons too (e.g. `waiting_approval` → "Duyệt" / "Xem"). Those buttons create and confirm a pending `approve_gate` action through the same path.

## 6. Web UI
- A chat page "Trợ lý AI" (`/assistant`) in the sidebar:
  - conversation list, message thread and input;
  - clarifying questions with `options` render as quick-reply chips;
  - pending actions render as cards with the summary and buttons;
  - tool activity shows as small collapsible lines ("Đã xem lịch đăng 7 ngày tới").
- The settings box on the page holds the `confirmMode` switch, with the label "Tự động hết (không hỏi lại, trừ thao tác xóa)".

## 7. Tests (mock LLM, no network)
Script the mock provider's step outputs per test.
- A read tool result feeds the next step, and the final reply arrives.
- An ambiguous request returns `clarify` with options, and nothing runs.
- A confirm tool creates a pending action without running it:
  - confirming runs it once;
  - a double confirm is a no-op;
  - an expired action cannot run;
  - reject marks it rejected.
- `confirmMode: "auto"`, or `autoConfirm` in the step, runs confirm tools at once. A delete still waits.
- Invalid tool name or args are retried once, then answered with an error. The step limit of 6 holds.
- No tool can reach tokens or credentials. The tool catalog snapshot contains no credential tool.
- Telegram:
  - a message from the paired chat reaches the assistant; any other chat is ignored;
  - callback confirm works and is verified against the chat id;
  - `/pause` triggers the kill switch without an LLM call.
- A 409 is returned for a concurrent message.
- Web:
  - sending a message renders the reply;
  - a pending card's confirm calls the API;
  - quick-reply chips send the option text.

## Done
Done checklist from the README. Write `docs/tasks/TASK-032.report.md` and `docs/tasks/TASK-032.done`.
