# TASK-065 — Cursor guide (edge-tts network retries and recovering from stage timeouts)

**Scope:** two pipeline failures that Hermes hit on long videos:
- edge-tts failing with a network or DNS error (`getaddrinfo failed`);
- `STAGE_TIMEOUT` on VISUAL_SEARCH and RENDER for videos with more than 20 scenes.

The app should recover from both by itself, within strict limits. When it still fails, the error message must tell the user exactly what to do.

Read `docs/cursor/README.md` first. Tests never use the network, the real edge-tts CLI, or real LLM CLIs. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

No new npm dependencies. One new table (section 3): run `npx drizzle-kit generate` in `apps/server`; never hand-write migrations.

**Order:** after TASK-064. It touches `jobs/worker.ts`, `pipeline/orchestrator.ts`, `providers/tts/*` and `services/visualService.ts`, so it should not run at the same time as TASK-059 to 062, which touch the same files. If one of those is still open, rebase on it rather than working around it.

**Out of scope:** switching models automatically when one is out of quota (`LLM_QUOTA_WAIT`). TASK-060 covers that.

## Why

**edge-tts** (`apps/server/src/providers/tts/edgeTts.ts`):
- `synthesize` retries only `NoAudioReceived` (6 attempts, waits from 3 to 60 seconds). Any other error is thrown at once.
- A DNS or connection error from the Python CLI (aiohttp `ClientConnectorError ... [getaddrinfo failed]`, `Temporary failure in name resolution`, `Cannot connect to host speech.platform.bing.com`) becomes a plain `Error`.
- `TtsRegistry.synthesize` (`providers/tts/registry.ts`, around line 300) wraps every failure as `StageError("TTS_FAILED", retryable: true)`. It drops the cause and any retry time.
- The orchestrator then retries the job after `JOB_RETRY_BASE_MS × 2^(attempt-1)`, which is 2 s and then 4 s. A DNS outage lasts longer than that, so all 3 attempts (`JOB_MAX_ATTEMPTS`) are spent in about 6 seconds and the stage fails.
- `dependencies.sleep` ignores the abort signal, so a long wait cannot be cancelled.

**Stage timeouts** (`jobs/worker.ts` around line 220, `packages/shared/src/pipeline/stageTimeouts.ts`):
- The limit is planned from the scene count (`baselineStageTimeouts`, and `ensureStageTimeoutPlan` when the budget allows). That part is good.
- A timeout is retryable, but **every retry gets the same limit**. A stage that is just slow fails three times in a row.
- The worker stops the stage even when it reported progress a moment ago, for example at 95% of a render.
- **VISUAL_SEARCH loses all its work on a timeout.** `VisualService.executeStage` (`services/visualService.ts`):
  - searches scene by scene and keeps the results in memory (`sceneSearches`);
  - writes candidates and `visual_search_state` only at the end, in one `this.repository.atomic(...)` block (around line 1675 and line 1708).
  - So a timeout at scene 25 of 30 throws away 24 finished searches, and the retry starts again from scene 1 with the same limit. That is the main reason long videos never finish this stage.
- VOICE already keeps finished scenes (`voiceExecutor.ts` reuses `audio_path`), so it resumes. RENDER reuses a finished video (`reused`). Check whether RENDER also reuses per-scene parts (section 2d).
- The final message is `Stage timed out after 1234567ms`. It is in English, in milliseconds, and does not say what to do.
- Only the web page `StageTimeoutPanel` and the REST routes `PATCH /api/projects/:id/stage-timeouts` and `/recompute` (`api/stageTimeouts.ts`) can change limits. Agents cannot even propose a change.

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| [p-retry](https://github.com/sindresorhus/p-retry) | MIT | Shape of a bounded retry: a list of attempts, an `AbortError` that stops retrying, retry only on errors you have classified. Copy the ideas, not the dependency. |
| [AWS: Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) | article | Waits grow and are capped; a retry time from the error wins over the default backoff. |
| [Temporal activity timeouts](https://docs.temporal.io/encyclopedia/detecting-activity-failures) | MIT (docs) | "Heartbeat timeout": a long task that keeps reporting progress is not stuck, so it may run past its first limit up to a hard cap. That is the model for section 2b. Concepts only, no SDK. |
| [edge-tts](https://github.com/rany2/edge-tts) | LGPL-3.0 | We only call its CLI. Read its exceptions (`NoAudioReceived`, `WebSocketError`, aiohttp `ClientConnectorError`) to classify messages. Copy no code. |

If you find a better project, report it (README rule 11).

## Rules for this task

- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Every retry is bounded: a fixed number of attempts, and a hard cap on any time limit. Nothing may loop forever.
- Never switch to a paid TTS or LLM provider because of a retry. The TTS fallback chain stays `fallbackChain(...)` as it is today.
- Never retry errors that will not fix themselves: a missing binary (`TTS_BINARY_MISSING`), a 401 or 403, a bad voice name, or invalid input.
- Error messages shown to the user are in Vietnamese and say what to do next.

## 1. edge-tts: retry on network errors

### 1a. Classify the error

In `edgeTts.ts`, add and export `isEdgeNetworkError(message: string): boolean`. It returns true when the message matches any of these (case-insensitive):

- `getaddrinfo`, `ENOTFOUND`, `EAI_AGAIN`
- `Name or service not known`, `Temporary failure in name resolution`, `nodename nor servname`
- `Cannot connect to host`, `ClientConnectorError`, `ServerDisconnectedError`, `ClientOSError`
- `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENETUNREACH`, `EHOSTUNREACH`, `Connection reset`
- `TimeoutError`, `timed out`

It returns **false** for:
- a WebSocket handshake with status 401 or 403. With edge-tts this is usually a clock or token problem, so retrying does not help;
- `NoAudioReceived`, which has its own loop;
- a missing binary.

Put real error lines from edge-tts (Windows and Linux) into the test as fixtures.

### 1b. Retry inside the provider

- Add `NETWORK_BACKOFF_MS = [30_000, 30_000, 30_000] as const`. That gives 1 attempt plus 3 retries, 30 seconds apart, which is what the user asked for.
- Keep a separate counter for network errors. The `NoAudioReceived` loop keeps its own 6 attempts and waits. The two counters do not share attempts.
- On each retry, log one line: `[edge-tts] network retry file=... attempt=N/4 reason=<first 120 chars>`.
- `sleep` must respect the abort signal. Change the dependency type to `sleep(ms, signal?)`. The default implementation clears its timer and rejects with an `AbortError` when the signal aborts. Then the job timeout or a user stop ends the wait at once.
- After the last network attempt, throw:
  - `StageError("Không kết nối được dịch vụ giọng đọc Edge (lỗi mạng hoặc DNS). Đã thử 4 lần trong khoảng 90 giây. App sẽ tự chạy lại bước Giọng đọc sau 5 phút; nếu vẫn lỗi, kiểm tra mạng hoặc chọn nhà cung cấp giọng khác ở trang Giọng đọc (TTS).", "TTS_NETWORK", true, retryAt)`;
  - `retryAt` is now + 5 minutes.

### 1c. Keep the cause in the TTS registry

In `TtsRegistry.synthesize`:
- If the chain fails and **every** provider that was tried failed with `TTS_NETWORK`, rethrow that `StageError` with its code and `retryAt`. Do not wrap it in `TTS_FAILED`.
- In every other mixed case, keep `TTS_FAILED`. Add the code of the last error to its message, for example `(edge-tts: TTS_NETWORK)`.
- The chain stays as it is. Do not add providers to it.

### 1d. Honour `retryAt` in normal retries

In `Orchestrator.failJob`, in the branch `if (error.retryable && job.attempt < job.maxAttempts)`:
- the delay is `max(JOB_RETRY_BASE_MS × 2^(attempt-1), retryAt - now)` when `error.retryAt` is set;
- this still uses up an attempt, so the limit stays `JOB_MAX_ATTEMPTS`. That is the difference from `LLM_QUOTA_WAIT`, which does not use up attempts. Do not add `TTS_NETWORK` to the quota-wait branch;
- the stage message is in Vietnamese: `Lỗi mạng giọng đọc, tự chạy lại lúc HH:mm (lần N/M)`.

So the worst case for a DNS outage with defaults: 3 jobs × about 90 seconds of provider retries, plus 2 waits of 5 minutes, which is about 15 minutes before the stage fails for good. Finished scenes are kept, so each retry starts where the last one stopped.

### 1e. Other HTTP TTS providers

Read `providers/tts/http.ts`. If it already retries network errors with backoff, leave it. If not, write down in the report what it does. Do not change it in this task.

## 2. Stage timeouts: give a slow stage a fair chance

### 2a. A longer limit on each retry after a timeout

In `packages/shared/src/pipeline/stageTimeouts.ts`, add:

```ts
export const STAGE_TIMEOUT_RETRY_GROWTH = 1.5;
export function retryStageTimeoutMs(stage: PlannedTimeoutStage, plannedMs: number, priorTimeouts: number): number
```

- It returns `plannedMs × 1.5^priorTimeouts`, clamped to `stageTimeoutCapMs(stage)`. That is 30 minutes for most stages and 2 hours for RENDER, CLIP and PUBLISH.
- `priorTimeouts` is 0 on a first run.

In `JobWorker`:
- Count `priorTimeouts`: if the job's stored `error.code === "STAGE_TIMEOUT"`, it is `job.attempt - 1`; otherwise 0. If the repository does not keep a history of earlier attempt errors, this approximation is fine.
- Pass the result of `retryStageTimeoutMs` in place of the plain `resolveStageTimeoutMs` value. Stages not in `PLANNED_TIMEOUT_STAGES` keep the fallback `STAGE_TIMEOUT_MS`.
- Log `{ plannedMs, timeoutMs, priorTimeouts }`.
- This does not save anything to the project. The stored plan stays the same; only this run gets more time.

### 2b. Do not stop a stage that is still moving

When the timer fires:
- If the stage reported progress in the last 60 seconds **and** its progress is still under 100, extend the deadline once by 50% of the current limit, clamped to the stage cap.
  - Use the existing `lastProgressAt`, and record the actual time of every progress report, including reports dropped by the 250 ms throttle.
  - Report progress with a Vietnamese message: `Còn đang chạy, gia hạn thêm N phút`.
- Allow **one** extension per attempt. If the timer fires again, time out as today.
- If there was no progress in the last 60 seconds, time out as today.

### 2c. VISUAL_SEARCH keeps finished scenes across retries

Add a table `visual_search_checkpoints` in `apps/server/src/db/schema.ts`:

| column | type |
|---|---|
| `scene_id` | text, primary key |
| `project_id` | text, not null, indexed |
| `search_hash` | text, not null |
| `queries` | text (JSON array) |
| `candidates` | text (JSON array of the in-memory candidates) |
| `created_at` | text |

Then run `npx drizzle-kit generate`.

In `VisualService.executeStage`, inside the per-scene loop:
- **Before** calling `resolveQueries` for a changed scene: look up a checkpoint with the same `scene_id` and `search_hash` that is less than 6 hours old. If one exists:
  - reuse its `queries` and `candidates` and skip the network search;
  - count it in a new `stats.checkpointHits`;
  - still push it with `unchanged: false`, so ranking, alt-query assist, vision and the final write all run as before.
- **After** `resolveQueries` returns: upsert the checkpoint at once, outside the final atomic block.
- **After** the final atomic block commits: delete the project's checkpoints.
- A checkpoint never replaces a user's selection. The existing `protectedSelection` logic does not change.
- The stage message gets `· dùng lại N cảnh đã tìm` when `checkpointHits > 0`.

Check that vision, rerank and alt-query calls go through the LLM cache (`providers/llm/cache.ts`), so a retry does not pay for them again. If any of them skips the cache, list it in the report. Do not change it here.

### 2d. RENDER

Read the render code under `stages/render/` and `services/` that `RenderExecutor` calls:
- If it already reuses per-scene parts that were rendered on an earlier attempt, say so in the report.
- If it renders everything again, do not build part caching here. Write it down as a follow-up with your estimate of how much time it would save.

### 2e. A clear message when it finally fails

Replace the English timeout message in the worker (both the thrown `StageError` and the `failJob` payload) with:

`Bước <nhãn> chạy quá <N> phút (dự án <S> cảnh, lần <a>/<m>). Có thể tăng thời gian chờ ở mục "Thời gian chờ" của dự án.`

- Use `STAGE_TIMEOUT_LABELS_VI` for the label, whole minutes, and the scene count from the project.
- Keep the code `STAGE_TIMEOUT`.
- Add `timeoutMs` and `sceneCount` to the agent event `stage_failed`, if its shape allows extra fields. Otherwise put them in the summary text.

## 3. A tool so agents can propose a longer limit

Add `update_stage_timeouts` to the shared tool registry (`apps/server/src/assistant/tools.ts`):

- **Risk:** `confirm`. It becomes a pending action that only the user approves, like other confirm tools (TASK-047).
- **Input:** `{ projectId, stages: { [stage]: minutes } }`.
  - Only stages in `PLANNED_TIMEOUT_STAGES`.
  - Minutes are clamped to the floor (1 minute) and the stage cap; the result shows the clamped values.
  - At most 11 stages.
- It calls the same service as `PATCH /api/projects/:id/stage-timeouts`. Do not write a second code path.
- It refuses project `56374fb2-54cf-48ff-9441-2e6c653295d4` with a clear message.
- The description says when to use it: after a stage timed out twice on the same project, with the numbers from `get_pipeline`.
- Also add a read tool `get_stage_timeouts` (`read`) that returns the planned limit per stage, the scene count and when the plan was made. Skip it if `get_pipeline` already returns these fields; say which in the report.
- MCP gets both tools through the shared registry. Add them to `apps/mcp/test/tools.test.ts` in the same way as the other tools.

Then update `.agents/skills/video-lich-san-xuat/SKILL.md`:
- In section `## Khi pipeline bị kẹt`, change step 3 of `STAGE_TIMEOUT` to: propose `update_stage_timeouts` (confirm) with the numbers, instead of "agent không có tool đổi thời gian chờ".
- Add `update_stage_timeouts` (and `get_stage_timeouts` if you added it) to its frontmatter `tools`.
- In the TTS part, say that the app now retries network errors by itself (4 attempts in about 90 seconds, then again after 5 minutes). The agent waits for those before it reports.
- Keep the file valid for TASK-063's parser: no "…", no "TODO", and every tool listed must exist.

## 4. Tests

All tests use fakes: a fake `spawnProcess`, a fake `sleep`, a fake clock, and fake image providers that count calls.

**`apps/server/test/edgeTts.test.ts`:**
- A network error, then success: 2 spawns and one 30-second sleep, and audio is returned.
- 4 network errors: a `StageError` with code `TTS_NETWORK`, `retryable` true, and `retryAt` = fake now + 5 minutes; 3 sleeps of 30 seconds.
- Mixed errors: one network error, then `NoAudioReceived`, then success. The two counters stay separate.
- Handshake 403: thrown at once, with no retry.
- Aborting during the 30-second sleep: an `AbortError` at once, and no further spawn.
- A table test for `isEdgeNetworkError` with real Windows and Linux lines.

**TTS registry test:**
- A chain where every provider fails with `TTS_NETWORK` → `TTS_NETWORK` with `retryAt` is kept.
- A mixed chain → `TTS_FAILED`, and the message names the last code.

**Orchestrator test:**
- A retryable error with `retryAt` 5 minutes ahead → `runAfter` is that time, not 2 seconds, and the attempt goes up by one.
- With no `retryAt`, the behaviour does not change.

**Shared test for `retryStageTimeoutMs`:**
- growth with 0, 1 and 2 earlier timeouts;
- the cap for VISUAL_SEARCH (30 minutes) and RENDER (2 hours).

**`apps/server/test/worker.test.ts`:**
- A second attempt after `STAGE_TIMEOUT` runs with 1.5 times the planned limit.
- An executor that keeps reporting progress gets one extension and finishes.
- An executor that reported nothing in the last 60 seconds times out with no extension.
- A second deadline after an extension times out.
- The final message is Vietnamese and contains the label, minutes and scene count.

**Visual search checkpoint test** (in an existing `visualService` test file, or a new one):
- 6 scenes, and the signal aborts after scene 4 → 4 checkpoints are saved.
- Rerun → the fake providers are called only for scenes 5 and 6, and the stage message says `dùng lại 4 cảnh đã tìm`.
- After a successful run, there are no checkpoints left for the project.
- A changed `search_hash`, or a checkpoint older than 6 hours, is not used.
- A user selection on a scene that has a checkpoint is kept.

**Tool tests:**
- `update_stage_timeouts` creates a pending action and does not change anything until it is approved.
- Values are clamped.
- The protected project is refused.
- An unknown stage is refused.

**Skill test:** the real-files test from TASK-063 still loads all seven `video-*` skills after the edit.

## 5. User guide

- **`docs/user-guide/xu-ly-su-co.md`:** add two entries.
  - "Giọng đọc báo lỗi mạng / getaddrinfo": the app retries by itself (4 attempts in about 90 seconds, then after 5 minutes, up to 3 rounds). What the user can do: check the network or DNS, or choose another TTS provider.
  - "Bước chạy quá thời gian": each retry gets 1.5 times more time, a stage that is still moving gets extended once, and image search keeps the scenes it has already found. Where to raise the limit: the "Thời gian chờ" panel. Agents can only propose a change.
- **`docs/user-guide/du-an-va-quy-trinh.md`:** one line in the stage timeouts part about retries and extensions.
- **`docs/user-guide/tu-van-hanh.md`:** one line saying that `update_stage_timeouts` needs the user's approval.
- **`featureMap`**, and an entry in `nhat-ky-thay-doi.md`.

## 6. Live check

Run the app locally on a test project. Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

1. With the mock or Edge TTS, cut the network: turn off Wi-Fi, or point `EDGE_TTS_PATH` at a small test script that prints a `getaddrinfo failed` line and exits 1. Run VOICE. Check:
   - the log has the 4 attempts;
   - the stage shows the Vietnamese retry message and time;
   - the job is queued about 5 minutes later;
   - after the network is back (or the script is put back), the stage finishes and reuses the scenes that were done.
2. Set the VISUAL_SEARCH limit to 1 minute on a project with at least 25 scenes, using the panel. Run the stage. Check:
   - it times out or extends;
   - the second attempt reuses the checkpoints and its limit is 1.5 minutes;
   - the final message is in Vietnamese if it still fails.
3. Call `update_stage_timeouts` from the assistant. Check that it appears as a pending action and that nothing changes before you approve it.

Write the results in the report, including any step you could not run.

## Done checklist

- [ ] `npm run typecheck` and `npm test` pass (README commands).
- [ ] The migration was generated by `drizzle-kit`, not hand-written.
- [ ] No new npm dependencies.
- [ ] Every retry and extension is bounded and covered by a test.
- [ ] No paid provider is added to any fallback path.
- [ ] `video-lich-san-xuat` is updated and still loads.
- [ ] The user guide, `featureMap` and changelog are updated.
- [ ] The report lists:
  - what `http.ts` does on network errors;
  - whether RENDER reuses parts;
  - whether vision, rerank and alt-query calls hit the LLM cache;
  - which live-check steps ran.
- [ ] Nothing committed or pushed.
