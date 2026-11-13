# TASK-084 — Originality gate + source manifest

**Who:** Codex. **Size:** M. **Order:** after RESEARCH-086 and BUGFIX-VISUAL. This task adds one table, so **no other agent may be generating a drizzle migration while it runs**. Before you run `npx drizzle-kit generate`, check that `apps/server/drizzle/meta/_journal.json` ends at `0062_condemned_la_nuit` (or the newest file on disk) and that nobody else changed it in the last minutes.

Read first: `docs/cursor/README.md`, this file, `docs/research/monetization/gap-analysis.md` (gap #1), `docs/research/monetization/automation-risk.md` (per-platform checklists, lines 1–60). Never open a file over 300 lines whole; `visualService.ts` and `db/schema.ts` are huge, so grep them.

## Why

Research 072 ranks this gap first. YouTube (inauthentic / reused content), Facebook (originality update 03/2026), TikTok and Instagram all demonetize or limit channels whose videos look mass-produced, repeat each other, or only reuse third-party material with light edits. We produce videos automatically for many channels, so this is the biggest risk to income. Today nothing records **what each video is made of** or **what our own contribution is**, and nothing compares a new video with the channel's earlier ones.

An AI label, a stock licence and originality are separate checks (automation-risk.md line 46). This task covers originality and the evidence trail. It does not decide copyright.

## The user's decision

When the evidence of our own contribution is missing, or a video is too close to an earlier video of the same channel, **the video goes to the user for review**. It is never published public automatically. Never invent minimum percentages "from the platform"; the thresholds are our own settings, shown as such in the UI.

## Mã nguồn mở có sẵn

- Perceptual hash: reuse `packages/shared/src/visuals/phash.ts` (`dHashFromGray`, `hamming`, `hashesMatch`) and `dedupe.ts`. Do not add OpenCV or a video-fingerprint library.
- Text similarity: word shingles + Jaccard, a few lines of our own code (the idea behind MOSS winnowing). No new dependency.
- If you find a permissive open-source originality or near-duplicate video detector worth using later (for example `videohash`, MIT, Python), report it (README rule 11), do not add it.

## Rules for this task

- No commit or push. No new npm dependency. One migration via `npx drizzle-kit generate` in `apps/server`; never hand-write SQL.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/assets/compose/**`, `packages/shared/src/compose/**`.
- Tests: no network, no real LLM, TTS or vision. Use fixtures and in-memory SQLite like the existing tests.
- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Other agents work in the same checkout: before editing a shared file (`docs/user-guide/**`, featureMap, `apps/server/src/app.ts`, `db/schema.ts`), re-read it and make a small edit; never rewrite it whole.
- Update the user guide (Vietnamese) and featureMap.

## 1. Source manifest (new table `source_manifests`)

One row per project, rebuilt each time the timeline is built and again after each render (keep `renderId` of the latest). Columns: `id`, `projectId` (FK, cascade), `renderId` (nullable), `manifest` (JSON), `scores` (JSON), `verdict` (`OK` | `REVIEW`), `createdAt`, `updatedAt`. Index on `projectId`.

`manifest` JSON (define a zod schema in `packages/shared`):
- `script`: research sources used (URLs/titles from the script stage), word count of our narration, whether it contains analysis/explanation (from the script's structure, not an LLM call).
- `assets`: one entry per scene asset: `kind` (`own_template` = compose map/compare/quote/list/text, `stock`, `web`, `ai_generated`, `user_upload`, `third_party_footage`), `sourceUrl`, `license` and `licenseVerified` (from `visual_selections` / candidates), `screenSeconds`, `pHash` if we already have one.
- `voice`: TTS provider and voice (own narration counts as contribution).
- `contribution`: computed summary: share of screen time from `own_template` + narrated analysis, number of distinct third-party sources, AI-generated share (for disclosure).

Build it from data the app already stores; do not re-download images.

## 2. Compare with the channel's own videos

For the project's profile (channel), take the last N (setting, default 30) projects that reached RENDERED or PUBLISHED:
- **Script:** 5-word shingles, Jaccard against each earlier script. Keep the max and which project.
- **Visuals:** count chosen images whose pHash matches (`hashesMatch`) an image used in an earlier project of the same profile.
- **Title:** normalized token Jaccard against earlier titles/metadata.

Store the results in `scores`. Pure functions in `packages/shared` with unit tests; the DB query lives in the server.

## 3. The gate

Settings (per profile, defaults in code, editable on the existing guideline settings page): `maxScriptSimilarity` 0.5, `maxReusedImages` 3, `minOwnContributionShare` 0.3, `requireNarration` true. Show a note in the UI that these are our own safety thresholds, not platform rules.

When a threshold fails or evidence is missing (no narration, no research source, assets with unknown licence on most screen time), write findings into `guideline_findings` with `source: "CODE"`, `stage: "TIMELINE"`, `ruleId` `ORIG_SCRIPT_SIMILAR` / `ORIG_IMAGES_REUSED` / `ORIG_LOW_CONTRIBUTION` / `ORIG_NO_EVIDENCE`, severity `MUST`, with a Vietnamese text that names the earlier project and the number. Set `verdict = REVIEW`.

Because `evaluatePublishGuardrail` (`publishing/guardrail.ts`) already forces private upload on open MUST findings, the existing path does the rest. Also make sure AUTO/autopilot raises the usual "Cần bạn xử lý" item for these findings (reuse what TASK-077 uses for `VISUAL_NEEDS_USER`). The user can dismiss a finding with a reason, as today; the dismissal and reason stay in the manifest history.

Re-running the check removes its own old `ORIG_*` OPEN findings first, so they do not pile up.

## 4. Per-platform checklist

Add the YouTube, TikTok, Facebook and Instagram originality items from `automation-risk.md` as `TIP` findings or a checklist panel (your choice, keep it small), each with its source link. They are reminders, not blocks.

## 5. API, UI, assistant

- `GET /api/projects/:id/originality` returns manifest, scores, verdict, findings. `POST .../originality/recheck`.
- A small "Nguồn & tính nguyên bản" card on the review/publish step: verdict, top similar earlier video, contribution share, asset list with licence and source link.
- Register a read-only tool `get_originality_report` in the shared tool registry (assistant + MCP + operator), risk `read`.

## 6. Tests and done

- Unit: shingle Jaccard, contribution share, manifest builder from fixtures, gate thresholds, re-check does not duplicate findings.
- Integration (in-memory DB): two projects in one profile with the same script → second one gets `ORIG_SCRIPT_SIMILAR` MUST and the guardrail returns `forcePrivate`.
- Run the README checklist (typecheck, tests, lint, build for the touched workspaces). Write `docs/tasks/TASK-084.report.md` (what you built, files, test results, anything skipped) and then create `docs/tasks/TASK-084.done`.
