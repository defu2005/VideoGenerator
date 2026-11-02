# TASK-004E — Token Budget Modes (ECO / BALANCED / QUALITY / CUSTOM)

## GOAL
Let the user choose how much LLM usage a project may spend, instead of always using the minimum. Each mode enables a defined set of LLM features with a known call count; the UI shows an estimate before running. Deterministic work stays code in every mode.

## CONTEXT
- Read `docs/ARCHITECTURE.md` §4 "Chế độ ngân sách token" and "Quy tắc LLM" (updated 2026-11-03; supersedes the old hard 1-call budget).
- Existing: `settings.researchMode` (merged|separate|off), `generateStructured` with ≤1 repair call, deterministic normalization in shared schemas, pre-flight limits, provider usage counter, brief recommendations (`recommendBrief`) with `userSet`.
- Real provider note: Copilot CLI counts **requests**, not tokens; estimates must show calls (and tokens when known).

## FILES TO INSPECT
- `packages/shared/src/schemas/project.ts`, `src/brief/*`, `src/schemas/script.ts`
- `apps/server/src/providers/llm/structured.ts`, `preflight.ts`, `tokenEstimate.ts`
- `apps/server/src/stages/research/*`, `src/stages/script/*`
- `apps/web/src/features/projects/BriefFields.tsx`, `src/features/pipeline/PipelinePanel.tsx`, `src/features/script/*`

## FILES TO CREATE/MODIFY (guide)
```
packages/shared/src/budget/modes.ts          # BudgetMode, BudgetFeatures, resolveBudget()
packages/shared/src/schemas/project.ts       # settings.budget
packages/shared/src/brief/recommend.ts       # recommend budget mode (BALANCED default)
packages/shared/test/budget.test.ts
apps/server/src/providers/llm/structured.ts  # repairAttempts from budget
apps/server/src/stages/research/*, stages/script/*   # mode-driven behavior
apps/server/src/stages/script/reviewPrompt.ts        # QUALITY: review & revise
apps/server/src/api/budget.ts                # GET /api/projects/:id/budget-estimate
apps/web: BudgetModeField, estimate line near Generate All, review notes in Script tab
tests
```

## REQUIREMENTS

### 1. Model (shared, pure)
```ts
type BudgetMode = "ECO" | "BALANCED" | "QUALITY" | "CUSTOM";
interface BudgetFeatures {
  storyMode: "merged" | "separate";      // research+script in 1 call, or 2 calls
  repairAttempts: 0 | 1 | 2;             // LLM repair calls after deterministic normalization fails
  scriptReview: boolean;                 // QUALITY: 1 extra "review & revise" call
  altQueryAssist: boolean;               // hook for TASK-006: LLM suggests alternative image queries when results are poor
  semanticImageRerank: boolean;          // hook for TASK-006: LLM re-ranks candidates from text metadata (no vision)
  visionCheck: boolean;                  // hook for TASK-007: always false unless CUSTOM sets it
  musicAssist: boolean;                  // hook for TASK-010
}
```
`resolveBudget(mode, customOverrides?)` returns features:
| feature | ECO | BALANCED | QUALITY |
|---|---|---|---|
| storyMode | merged | separate | separate |
| repairAttempts | 0 | 1 | 1 |
| scriptReview | false | false | true |
| altQueryAssist | false | true | true |
| semanticImageRerank | false | false | true |
| visionCheck | false | false | false |
| musicAssist | false | false | true |
`CUSTOM` = BALANCED defaults overridden by `settings.budget.features` (partial).

Settings: `settings.budget: { mode: BudgetMode (default BALANCED), features?: Partial<BudgetFeatures> }`. Backward compatibility: if a project has an explicit `researchMode` in `userSet`, it overrides `storyMode` (`off` keeps its meaning: research SKIPPED, script-only call). Remove nothing.

Recommendations: `budget.mode` recommended `BALANCED` with reason "Default balance of cost and quality"; shown with the other brief fields.

### 2. Server behavior per mode
- RESEARCH/SCRIPT use `storyMode` (merged = existing 1-call path; separate = research call then script call).
- `generateStructured` uses `repairAttempts` (0 = fail after normalization; message suggests switching to BALANCED).
- `scriptReview` (QUALITY): after the script is produced (from either path), one extra call: "review & revise" — input: research summary + script; output: `{ revisedScript: Script, notes: string[] (≤8) }`. Store `revisedScript` as the script (origin AGENT, version+1) and keep `notes` on the script row (`review_notes` JSON). Prompt compact; must keep language, target duration, section ids, visual queries schema. Cached by input hash.
- Hooks (`altQueryAssist`, `semanticImageRerank`, `visionCheck`, `musicAssist`) are only stored/resolved now; later tasks read them via `resolveBudget(project)`.
- Pre-flight still applies; if a provider limit forces separate in ECO, the job message explains it.
- Job usage records which feature made each call (`usage.features: Record<string, number>`), e.g. `{ story: 1 }`, `{ research: 1, script: 1, review: 1 }`.

### 3. Estimate (before running)
`GET /api/projects/:id/budget-estimate` → `{ mode, features, perStage: [{ stage, calls: {min, max}, reason }], total: {min, max}, tokens?: {input, output} }`:
- Calls: ECO 1; BALANCED 2 (+0–1 repair per call → max); QUALITY 3 (+repairs); research `off` → script only. Stages already DONE and unchanged → 0 (cache/no rerun).
- Tokens from the existing `tokenEstimate` heuristics; omit when the provider reports requests only (copilot-cli/claude-cli) and say "requests".
- Pure function in shared (`estimateBudget(project, provider)`) so the UI can preview live while editing; endpoint uses the same function.

### 4. UI
- BriefFields: "Chế độ AI / Budget mode" select with one-line descriptions:
  - ECO — "Rẻ nhất (~1 lượt gọi AI/video)"
  - BALANCED — "Cân bằng chất lượng/chi phí (~2–3 lượt)" (badge Gợi ý)
  - QUALITY — "Chất lượng cao: AI tự review & sửa script (~3–5 lượt)"
  - CUSTOM — expands toggles for each feature (hooks show "available in a later step").
- Next to **Generate All**: "Ước tính: ~2–3 lượt gọi AI (BALANCED)". Changing mode updates it live.
- Script tab: in QUALITY, show review notes (collapsible) and "Revised by AI review" badge.

## LLM calls (per Generate All through SCRIPT)
ECO 1 · BALANCED 2 (max 4 with repairs) · QUALITY 3 (max 6 with repairs) · cached rerun 0 in all modes.

## DO NOT
- Do not move any deterministic logic into LLM calls in any mode.
- Do not enable vision anywhere by default.
- Do not change committed migrations; add a new one only if needed (e.g. `scripts.review_notes`).
- Do not add dependencies. Do not run real `copilot` prompts. Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck/build/test pass; all existing tests pass (update ones that assumed the merged default — the default mode is now BALANCED; keep explicit merged tests via ECO).
2. Mock provider call counts through SCRIPT: ECO 1, BALANCED 2, QUALITY 3; cached rerun 0 each; CUSTOM with `{storyMode:"merged", scriptReview:true}` = 2.
3. `repairAttempts: 0` makes an invalid (non-normalizable) output fail after 1 call; `1` allows exactly one repair.
4. QUALITY stores revised script + review notes; version increments; Script tab shows notes.
5. Estimate endpoint and UI line match the actual counts in the mock tests; DONE stages count 0.
6. Projects created before this task (no `budget`) behave as BALANCED unless `researchMode` is user-set.

## TESTS
Shared: `resolveBudget` table, CUSTOM overrides, `estimateBudget` per mode/stage states, recommendation reason. Server: per-mode call counts, repairAttempts 0/1, review stores notes + version, usage.features, researchMode back-compat, estimate endpoint. Web: mode select + live estimate, CUSTOM toggles, review notes rendering.

## DEPENDENCIES
TASK-004, 004C, 004D (done).

## REPORT BACK
Write `docs/tasks/TASK-004E.report.md` (files, migration if any, call counts per mode from tests, command results, deviations, remaining issues). Then create empty `docs/tasks/TASK-004E.done`.
