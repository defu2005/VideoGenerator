# TASK-050 — Cursor guide (LLM sets a stage timeout per project)

Read `docs/cursor/README.md` first. No new npm dependencies. Tests never use the network or a real LLM. No migration: this lives in the project `settings` JSON.

This task does not depend on TASK-046, TASK-047 or TASK-049. If `docs/user-guide/` and `packages/shared/src/features/featureMap.ts` from TASK-048 are already in the tree, update them. If they are not, skip that part and say so in the report.

## Why

Every pipeline job shares one ceiling, `STAGE_TIMEOUT_MS` (default `600_000`, ten minutes), in `apps/server/src/jobs/worker.ts`. A 30-second short and a 30-minute documentary get the same limit. A long render or a heavy visual search is killed too early. A hung short job can hold the single worker for the full ten minutes.

The brief already says how big the job is: `targetDurationSec` (30–1800), `sceneDurationSec`, `wordsPerMinute`, `style`, `platform`, `aspectRatio`, and the budget mode. Use that, plus one fast LLM call, to pick a ceiling per stage for this project.

Per-call limits stay as they are. Do not change `LLM_TIMEOUT_MS`, `TTS_TIMEOUT_MS`, `IMAGE_SEARCH_TIMEOUT_MS`, or `MUSIC_SEARCH_TIMEOUT_MS`. Those cut one request. This task only changes the ceiling of the whole stage job. Providers are built once in `apps/server/src/providers/llm/registry.ts` with a fixed LLM timeout; do not rebuild them per project. The job `AbortSignal` already stops the stage when the ceiling hits.

## 1. Baseline in shared code (no LLM)

Add a pure function, for example `baselineStageTimeouts`, in `packages/shared/src/pipeline/stageTimeouts.ts`, and export it from `packages/shared/src/index.ts`.

Inputs: `targetDurationSec`, `sceneDurationSec`, `wordsPerMinute`, `style`, `platform`, `aspectRatio`.

Stages that get a plan (real work):

`RESEARCH`, `SCRIPT`, `SCENE_PLAN`, `VISUAL_SEARCH`, `VOICE`, `SUBTITLE`, `MUSIC_SEARCH`, `TIMELINE`, `RENDER`, and the side jobs `CLIP` and `PUBLISH`.

Do not plan `VISUAL_REVIEW`, `MUSIC_REVIEW`, or `FINAL_APPROVAL`. Those gates wait for the user. Leaving them on the global default means a waiting gate is not failed by this plan. `TOPIC` and `DONE` are not jobs.

Rules the tests must lock:

- Scale with duration. At the same style, a 30 s video is at or near the floor; 120 s is the reference; 1800 s is clearly higher, especially `RENDER`, `VOICE`, and `VISUAL_SEARCH`.
- Scene count is `ceil(targetDurationSec / sceneDurationSec)`, at least 1. More scenes raise `VISUAL_SEARCH`, `SCENE_PLAN`, and `RENDER`.
- Style weight: `documentary` and `news` raise `RESEARCH` above `explainer` and `listicle` at the same duration. `listicle` raises `VISUAL_SEARCH`.
- A short (`platform` `youtube_shorts`, `tiktok`, or `facebook_reels`, or `targetDurationSec` ≤ 60) stays near the floor.
- `wordsPerMinute` below the default 150 raises `SCRIPT` and `VOICE` slightly (denser narration). `9:16` raises `RENDER` slightly above `16:9` at the same duration.
- Clamp every value: minimum `60_000` ms. Maximum `1_800_000` ms (30 min), except `RENDER`, `CLIP`, and `PUBLISH`, whose maximum is `7_200_000` ms (2 h).
- Return integer milliseconds. The 120 s / storytelling / youtube / 16:9 / 150 wpm / 7 s scene case must be stable and covered by a snapshot-style assertion (exact numbers, not a range).

`STAGE_TIMEOUT_MS` stays the fallback when a stage has no planned value.

## 2. One LLM task, `stageTimeouts`

Follow the existing LLM-task pattern:

- Add `"stageTimeouts"` to `LlmTaskIdSchema` and `LLM_TASKS` in `packages/shared/src/schemas/llm.ts`. Label `Thời gian tối đa mỗi bước`. Stage `SETTINGS`. Tier `fast`, `qualityWeight` 1. Purpose: choose a per-stage timeout from the brief.
- Add budget feature `stageTimeouts: z.boolean()` in `packages/shared/src/budget/modes.ts`. **On** in ECO, BALANCED, QUALITY, and MAX. CUSTOM defaults to on. One call per plan, not per stage. Add it to the cost estimate as a single call when the feature is on and no fresh plan exists.
- Strict output schema `StageTimeouts` (the mock branches on `schemaName`):

```ts
{
  stages: Array<{ stage: string; timeoutSec: number; reason: string }>,
  summary: string
}
```

- Prompt input is only the brief fields, the scene-count estimate, the baseline seconds, and the min/max seconds per stage. Tell the model to raise time for long, dense, or documentary work and to keep shorts near the floor. It must not invent stages.
- Server clamps every `timeoutSec` into that stage's min/max from section 1. A value outside the range is clamped, not a failed job. Unknown stage names are dropped. Missing stages keep the baseline.
- `apps/server/src/providers/llm/mock.ts` returns a valid `StageTimeouts` object (use the baseline seconds so tests are deterministic).

Store the plan on `project.settings` (JSON column, no migration):

```ts
stageTimeouts?: {
  source: "llm" | "baseline" | "mixed",
  inputHash: string,
  summary: string,
  stages: Partial<Record<stage, { timeoutMs: number; reason: string; source: "llm" | "baseline" | "user" }>>
}
```

`inputHash` covers the brief fields listed in section 1 plus `topic` and the budget mode. Same hash → do not call the LLM again.

## 3. When the plan is built

Build or reuse the plan once, before the first pipeline job starts (`JobWorker.run` or the orchestrator path that claims the job — one place only).

- Feature on and hash matches a stored plan: use it.
- Feature on and hash differs or the plan is missing: call `generateRoutedStructured`. On success, `source` is `"llm"` (or `"mixed"` when some stages were clamped back to baseline or left empty). On any failure (no provider, timeout, bad JSON): log a warning, store the baseline with `source: "baseline"`, and **continue the pipeline**. This call must not fail the stage.
- Feature off: store the baseline, no LLM call.
- A stage entry with `source: "user"` survives a recompute. Other stages are replaced.

The call uses the job `AbortSignal` and the normal LLM timeout. It must finish well inside the stage ceiling. Do not nest a second stage-timeout race around it.

## 4. The worker uses the plan

In `apps/server/src/jobs/worker.ts`, the `setTimeout` / `STAGE_TIMEOUT` message uses the resolved milliseconds for `job.stage`:

1. `settings.stageTimeouts.stages[stage].timeoutMs` when present;
2. otherwise the baseline for that stage;
3. otherwise `config.STAGE_TIMEOUT_MS`.

The error text stays `Stage timed out after ${timeoutMs}ms` with the number actually used. `retryable` stays true. Retry behaviour in `failJob` does not change.

Same resolution for the synchronous aspect render in `apps/server/src/publishing/publishService.ts` that currently does `AbortSignal.timeout(this.config.STAGE_TIMEOUT_MS)` (about line 796). Pass the project's `RENDER` timeout.

## 5. UI

On the project page, near the brief (`apps/web/src/features/projects/`), show a short Vietnamese block **Thời gian tối đa mỗi bước**:

- one row per planned stage: Vietnamese stage name, minutes (one decimal), and the `reason`;
- a chip for the plan source: `AI`, `Ước lượng`, or `Trộn`;
- per row, if the user edited it, chip `Bạn chọn`;
- a number input to override one stage, saved as `source: "user"` and kept across recomputes;
- button **Tính lại** forces a new plan (clears the hash, keeps user rows);
- button **Xoá lựa chọn của tôi** on a user row returns that stage to the plan.

Empty plan (legacy project that has not run yet): the sentence `Sẽ tính khi dự án chạy.` No error banner.

Wire the read into the existing project payload. Add a small route to recompute and to set or clear one override, next to the other project routes in `apps/server/src/api/projects.ts`. Recompute on a running job is refused with a Vietnamese message; it applies on the next run.

## 6. Tests (no network, mock only)

- Baseline table: 30 s short, 120 s reference, 1800 s long; documentary vs explainer research; listicle visual search; clamp at both ends.
- Worker: a project plan of `50` ms fails a hanging stage with `STAGE_TIMEOUT` and that message, even when `STAGE_TIMEOUT_MS` is `600_000`. A stage missing from the plan uses the baseline, not the global ten minutes, when the brief is present.
- Unchanged `inputHash`: the mock is not called again. Changed `targetDurationSec`: one new call.
- LLM throw: baseline stored, the stage still completes.
- User row survives **Tính lại**.
- Mock `schemaName === "StageTimeouts"` parses. ECO estimate includes exactly one `stageTimeouts` call when no plan is stored, and zero when a fresh plan is stored.
- Web: the block renders minutes and the source chip; an override posts and shows `Bạn chọn`.

## 7. Live check

Throwaway project only. **Never touch project `56374fb2-54cf-48ff-9441-2e6c653295d4`.** Do not approve its gates or render it.

With the mock provider, create a ~30 s short and a long documentary brief, run **Tính lại**, and confirm the long project's `RENDER` minutes are higher. Attach nothing that contains tokens or personal data.

## Done

Done checklist from the README, including the user-guide update when TASK-048 is already present. Write `docs/tasks/TASK-050.report.md` and an empty `docs/tasks/TASK-050.done`.
