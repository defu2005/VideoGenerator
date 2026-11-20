# TASK-147a report (stage-agent adapter framework)

For Claude (Opus), the architect. Nothing committed or pushed.

## What changed
- **Stage Adapters Framework** (`apps/server/src/agents/stageAdapters/`):
  - `types.ts`: defined `StageAgentAdapter<TContext = unknown>` contract specifying `stage`, `role`, `buildContext()`, `validateComplete()`, `openReason()`, and `handoffErrors`.
  - `visualSearch.ts`: created `createVisualSearchAdapter(options)` encapsulating visual search context creation, validation against candidate images and verdicts, open scene reasons, and handoff error codes (`LLM_ALL_PROVIDERS_EXHAUSTED`, `VISION_PROVIDER_REQUIRED`, `IMAGE_SEARCH_RATE_LIMITED`).
  - `index.ts`: exported types and visual search adapter.
- **Agent Stage Service** (`apps/server/src/agents/stageService.ts`):
  - Replaced hard-coded visual search logic with adapter dispatch across `buildContext`, `validateComplete`, `openReason`, and `afterError`.
  - Dynamically computes `supportedStages` from registered adapters.
  - Refactored `claim()` to check the caller's assigned roles against the required adapter role (`matchingStageAssignment(..., { role: adapter.role })`), excluding `channel_manager`.
  - Retained backwards-compatible fallback for legacy constructor calls.
- **Agent Assignments** (`apps/server/src/agents/assignments.ts`):
  - Added optional `role?: string` parameter to `matchingStageAssignment` to filter assignments by the specific role required by a stage adapter.
- **Shared Schemas** (`packages/shared/src/agents/stageExecution.ts`):
  - Defined `AGENT_CAPABLE_STAGES = ["VISUAL_SEARCH", "RESEARCH", "MUSIC_SEARCH", "SCRIPT"]`.
  - Updated `StageExecutionSettingsSchema` to allow these stages for external agent execution.
  - Maintained default execution mode `app` for new stages; only `VISUAL_SEARCH` defaults to `app_then_agent`.
- **Server App Wiring** (`apps/server/src/app.ts`):
  - Initialized `createVisualSearchAdapter` and supplied it to `AgentStageService` under `adapters`.
- **Frontend UI** (`apps/web/src/features/`):
  - `BriefFields.tsx`: rendered controls for all `AGENT_CAPABLE_STAGES` (`Ai xử lý bước tìm ảnh`, `Ai xử lý bước nghiên cứu`, `Ai xử lý bước kịch bản`, `Ai xử lý bước tìm nhạc`).
  - `CreateProjectDialog.tsx`, `EditProjectDialog.tsx`, `ProfileDetailPage.tsx`: generalized `stageExecution.*` handling for value reading, setting, resetting, and payload serialization.
- **Tests**:
  - `packages/shared/test/stageExecution.test.ts`: updated schema tests to verify `SCRIPT`, `RESEARCH`, `MUSIC_SEARCH` are allowed, while unsupported stages like `SUBTITLE` fail.
  - `apps/server/test/agentStagesApi.test.ts`: updated API schema test to check that `SUBTITLE: "agent"` returns 400 and `SCRIPT: "agent"` succeeds (200).
  - `apps/server/test/agentStage.test.ts`: added test suite covering role mismatch rejection, `channel_manager` exclusion, unhandled stage exclusion, and adapter `handoffErrors` decision in `afterError`.
  - `apps/web/src/features/projects/BriefFields.test.tsx`: added assertions for the new stage execution select inputs.
- **Documentation**:
  - `docs/ARCHITECTURE.md`: added section on Stage-Agent Adapters framework under Pipeline.
  - `docs/user-guide/agent-nhan-stage.md`: documented expanded stages, default modes, adapter framework, and role-based matching.
  - `packages/shared/src/features/featureMap.ts`: updated `agent-stage-handoff` entry and settings keys.
  - `docs/user-guide/nhat-ky-thay-doi.md`: added changelog entry for TASK-147a.

## Test results
- `packages/shared/test/stageExecution.test.ts`: 2 passed.
- `apps/server/test/agentStage.test.ts`: 23 passed.
- `apps/server/test/agentStagesApi.test.ts`: 14 passed.
- `apps/server/test/agentVisualToolkit.test.ts`: 17 passed.
- `apps/web/src/features/projects/BriefFields.test.tsx`: 2 passed.
- `npm run build -w @vg/shared`: clean build.

## Deviations
- None. Kept strictly to part 147a (framework generalisation and visualSearch adapter isolation). No changes were made to concrete script, research, or music execution adapters (reserved for upcoming parts).
