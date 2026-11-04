# TASK-018 — Pre-render review chat (optional)

User request (2026-11-04): once every step is done and before render, the user can chat with an LLM to give feedback. The chat is optional and never blocks render.

## 1. When and where
- **Available** once a timeline exists, typically while FINAL_APPROVAL is WAITING_USER. It stays readable after render, so the next version can start from it (TASK-013).
- **UI:** a "Góp ý với AI" section in the Timeline tab, shown next to the timeline and collapsed by default.
- **"Duyệt & render"** works whether or not the chat was used.

## 2. Context (built by code, 0 LLM)
A compact JSON or markdown document made of:
- the brief and settings, plus the active guideline rules (TASK-017);
- per scene:
  - order, time range, narration;
  - visual titles, sources and licenses (text only);
  - motion;
  - placeholder flags;
- the music title, mix and license;
- subtitle stats;
- timeline warnings and open guideline findings;
- the proposals already applied in this thread.

It is hashed. Providers that support it use prompt caching, so later messages reuse the context.

**Long threads:** keep the last 12 messages plus a code-built list of the earlier decisions. No LLM summarizer.

**Vision opt-in:** a toggle attaches the selected image of each scene, or of chosen scenes. It is on by default in MAX, and the cost is shown first.

## 3. Assistant output (zod-validated)

```ts
{ reply: string; proposals: Proposal[] }
Proposal =
  | { type: "EDIT_NARRATION"; sceneId; text }              // stale: voice(scene), subtitles, timeline
  | { type: "EDIT_DURATION"; sceneId; durationSec | null }  // stale: timeline
  | { type: "EDIT_VISUAL_QUERY"; sceneId; query }           // re-search that scene, back to review
  | { type: "SET_MOTION"; sceneId; slot; motion }           // stale: timeline
  | { type: "MUSIC_MIX"; volume?; duckingDb?; fadeInSec?; fadeOutSec? }
  | { type: "MUSIC_QUERY"; query }
  | { type: "REORDER_SCENES"; sceneIds }
  | { type: "EDIT_METADATA"; title?; description?; tags? }
  | { type: "NOTE"; text }                                  // advice only, no action
```

- Every proposal is checked against the current data. An unknown sceneId or an out-of-range value is dropped, with a note in the reply.
- **The LLM never applies changes.** The user clicks "Áp dụng" on one proposal or "Áp dụng tất cả". The app then:
  - calls the existing services, which mark the affected stages stale;
  - shows "Chạy lại các bước bị ảnh hưởng" (voice for N scenes, subtitles, timeline), with a cost estimate.

## 4. Quick actions
- **"AI xem lại toàn bộ":** sends a first message asking for a critique against the guidelines, covering:
  - the hook;
  - pacing;
  - the visual fit with the narration;
  - music fit;
  - policy risks.
- **Suggested chips:** "Mở đầu cuốn hơn", "Rút ngắn còn 60s", "Kiểm tra chính sách", "Đổi giọng kể kịch tính hơn".

## 5. LLM routing and budget
- **New LlmTaskId `reviewChat`:** tier strong, routable like the other tasks, defaulting to the script route.
- **User-triggered:** allowed in every budget mode, ECO included. Each message shows its estimated input and output tokens before sending, and the usage is recorded per call in the job usage (TASK-004I).
- **Pre-flight limits** of the provider still apply.
- **CLI providers** (copilot-cli, claude-cli, agy) work too. Each message is one request, with the context passed in full.

## 6. Storage and API
- **Tables:**
  - `review_threads`: project, contextHash, createdAt;
  - `review_messages`: thread, role, content, proposals JSON, usage, createdAt;
  - `review_proposal_applications`: message, index, appliedAt, result.
- `GET /api/projects/:id/review`: the thread and its messages.
- `POST /api/projects/:id/review/messages` `{text, attachImages?}`: sends a message and returns the assistant message. The reply streams over SSE when the provider supports it.
- `POST /api/projects/:id/review/proposals/:messageId/:index/apply`.
- `DELETE /api/projects/:id/review`: starts a new thread.
- **MCP tools** `get_review_context` and `apply_review_proposal` give the same chat through Claude Desktop / Copilot Chat at 0 app tokens.

## 7. Tests
- Context builder: deterministic, hash stable.
- Proposal validation: drop invalid, keep valid.
- Apply each proposal type → the right stages go stale.
- Chat with the mock provider, including the usage record.
- Render is not blocked without a chat.
- Web: send a message, show proposals, apply, show the rerun banner.
- No network, no real CLI.
