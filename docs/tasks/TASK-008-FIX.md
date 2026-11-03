# TASK-008-FIX — finish TASK-008 (review found it incomplete)

Read `docs/tasks/TASK-008.md` again — it is the contract. The current working tree has the
provider/executor/API skeleton, but the architect review found these gaps. Fix all of them,
building on the existing files (do not start over).

## 1. Migration missing (blocker)
`voice_tracks` is in `apps/server/src/db/schema.ts` but no migration creates it
(latest is `0008_unique_goblin_queen.sql`, from TASK-007). Run `npx drizzle-kit generate` in
`apps/server` and keep the generated SQL + meta. Do not hand-write SQL. A server test must
run the VOICE stage against a migrated DB.

## 2. USER tracks are not protected (`stages/voice/voiceExecutor.ts`)
- A USER track must be kept when the scene's **narration** is unchanged, even if voice/rate/provider
  changed. Store a separate `narration_hash` (sha256 of narration only) or compare against the
  narration stored at upload time — add the column via the same drizzle migration.
- When narration changed, regenerate (origin becomes AGENT) and the stage message adds
  `· K giọng của bạn được tạo lại vì lời thoại đổi`.
- Remove the dead `getProjectSetting` (or use it) and the no-op ternary
  `existing?.origin === "USER" && … ? "AGENT" : "AGENT"`.
- Report progress for reused scenes too (progress currently jumps).
- `outputHash` must be a real hash of all track input hashes (not the constant `"voice"`),
  so downstream stale detection works.

## 3. `stageExecutors.voice === "USER"`
Implement as in TASK-008 §5: WAITING_USER until every narrated scene has a track; check how
`script === "USER"` is handled in `apps/server/src/pipeline/orchestrator.ts`. Test it.

## 4. Web Voice panel (missing entirely)
Create `apps/web/src/features/voice/` exactly as TASK-008 "Web" describes (per-scene audio
player, duration vs estimate warning > 30 %, origin badge "AI"/"Của bạn", "Tạo lại",
"Tải lên giọng của tôi", header with voice/speed/total and "Tạo giọng đọc"), mounted in the
project detail page next to the existing scenes/visuals panels. Verify the voice/speed selects
in `ProjectFormFields.tsx` load from `/api/tts/voices` filtered by language and save to
`settings.voice` (keep the TASK-014 `providerSwitchedTo` logic intact).

## 5. Tests (none were added — the counts were unchanged at 117/10/239/54)
Write every test listed in TASK-008 "Tests": edge-tts adapter with fake spawn (args, `--file`,
UTF-8 env, retry on NoAudioReceived/empty file, missing binary error, SRT parsing);
VoiceExecutor (create, reuse = 0 synth calls, only changed scene regenerated, deleted scene
track removed, USER track kept when only voice changed, regenerated when narration changed);
API (voices, summary, regenerate, upload wav fixture, audio route 206 on Range, stale marking);
web (Voice panel renders + regenerate/upload calls; settings voice select saves).

## Rules
Same as TASK-008. No new dependencies. No commit/push. Never run real edge-tts in tests.
`npm run typecheck`, `npm test`, `npm run build`, `npx drizzle-kit check` must pass, and the
report must list the **new test counts**.

## Done
Update `docs/tasks/TASK-008.report.md` (append a "FIX" section) and create an empty
`docs/tasks/TASK-008-FIX.done`.
