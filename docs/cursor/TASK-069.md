# TASK-069 — Cursor guide (fixes after the TASK-066 review: a real script revision, the publish gate on every account, gates for MCP "agent" calls)

**Scope:** TASK-066 is in and every test passes, but the review on 2026-11-10 found these problems:

- **Bug 1:** the script "revise" round changes nothing.
- **Bug 2:** the publish gate checks only the first account.
- **Gap 3 (older than 066):** MCP calls with the `agent` source skip every quality gate.

This task fixes these three only. It also runs the live check that TASK-066 skipped (§10 there).

Read `docs/cursor/README.md` first. TASK-059 and TASK-066 stay the spec; where they differ from this guide, this guide wins.

- Tests never use the network, real LLM or TTS CLIs, or real platform APIs.
- No new npm dependencies.
- No schema change is expected. If you need one, use `npx drizzle-kit generate` in `apps/server`.
- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Do not commit or push.

**Order:** after TASK-066. Fable is working on TASK-067 at the same time, but only in new folders: `packages/shared/src/compose/**`, `apps/server/src/compose/**`, `apps/server/src/providers/footage/**`, `apps/server/assets/compose/**`, `docs/compose/**`. **Do not touch those folders.**

**Out of scope:**
- new grants;
- a new gate;
- changing the script prompt for normal (first) runs.

---

## 1. Bug 1: the script revision returns the same script

### What happens now

- `approve_gate` (`apps/server/src/assistant/tools.ts`, around line 885), with `ctx.autonomyRun` set and `scriptGateDecision === "revise"`:
  - adds 1 to `scripts.revise_round`;
  - calls `ctx.orchestrator.runStage(projectId, "SCRIPT")`.
- `ScriptExecutor` (`stages/script/scriptExecutor.ts`):
  - builds the **same** prompt (`scriptPrompt(...)` in `stages/script/prompt.ts`);
  - calls `generateRoutedStructured` with `cache: this.cache` and `cacheKeyExtra: inputHash` (around line 226).
- `inputHash = scriptInputHash(project, researchHash)` (`stages/script/scriptUtils.ts`). It does not include the revise round or any feedback.
- `LLM_CACHE_ENABLED` defaults to `true`. So the cache returns the old script, the review gives the same score, and after 2 rounds the gate holds.

The merged research+script path (around lines 60–72, `mergedSource`) can also reuse the old script without calling the model at all.

### What to build

1. **Revision feedback.** Add a pure helper, `scriptRevisionFeedback(sqlite, projectId): { round: number; reasons: string[] }`, in `operator/qualityGates.ts` or next to the script stage. It reads:
   - `scripts.revise_round`;
   - `scripts.quality_score` against `minQualityScore` (reuse `scriptGateInputs`). Example reason: "Điểm 5.5/10, cần ≥ 7".
   - the blocking fact notes, from wherever `scriptExecutor` stores the fact-check result with `severity` (`grep -n "blockingFacts\|severity" stages/script/scriptExecutor.ts`). Take only the blocking ones, as plain text.
   - the open `MUST` guideline findings for stage `SCRIPT` (`guideline_findings`).
   - the last `review_notes` (JSON `string[]`).

   Cap it at 8 reasons and 1 200 characters in total. Comments and trend titles never go in here: those are untrusted text.
2. **The revision prompt.** When `round > 0` and the script row was written by the agent (`origin = 'AGENT'`, `edited = false`), the executor:
   - skips the `mergedSource` reuse path;
   - adds a block after the normal prompt: `"Bản trước chưa đạt. Sửa đúng các điểm sau, giữ ý chính và độ dài mục tiêu:"` plus the reasons as a list, plus the previous script text (a trimmed JSON of the scenes);
   - puts `round` and a hash of the reasons into `cacheKeyExtra`, for example `` `${inputHash}:rev${round}:${sha(reasons)}` ``. A revision therefore never hits the cache of the first draft. The same revision retried after a crash may still hit its own cache.
   - Normal runs (`round = 0`) keep today's prompt and cache key exactly. Test that this is so.
3. **A user edit resets the loop.** When the user edits the script (`scriptService.ts`, the upsert around line 116) or presses "Tạo lại kịch bản" in the UI, set `revise_round = 0`. Today the upsert leaves the column alone.
4. **Waiting for the revision.** `runStage` errors are swallowed today (`catch {}`). Do this instead:
   - if `runStage` throws, record the reason with `recordHeld`, create the same `approve` user request as the "hold" branch, and return `{ held: true }`;
   - if it starts, return `{ held: false, waiting: "revision", reviseRound }` as now.
5. **Cost.** Each revision is one more script call, plus a review call when review is on. Keep the existing cap of 2 rounds (`scriptGateDecision`). Revision calls go through the normal usage and cost accounting (`addUsage`, `estimateLlmCost`). Check that they show up in usage.

**Tests (server, mock LLM):**
- `round = 0`: the prompt and the cache key are unchanged (a snapshot of the key format).
- `round = 1` with a low score and 1 blocking fact:
  - the prompt holds the feedback block and both reasons;
  - the mock LLM is called again even with the cache on (it was **not** called again before the fix: write the test so that it fails on the old code);
  - the new script's `quality_score` comes from the new review.
- Two failed rounds → hold, with an `approve` request.
- The user edits the script → `revise_round = 0`.
- Feedback never includes comment or trend text, and is cut at 8 reasons and 1 200 characters.

## 2. Bug 2: the publish gate checks only the first account

**What happens now:** in `publish_project` (`assistant/tools.ts`, around line 946), `publishGateCheck(...)` runs only for `body.accountIds[0]`. With 2 or more accounts, the slot and daily-quota checks are skipped for the rest.

**Fix:**
- Run `publishGateCheck` for **every** account in `body.accountIds`.
- Choose one way to handle a mix of passing and failing accounts and write it in the report. Recommended: **all or nothing.** If any account fails, throw `PUBLISH_GATE` (409) and name the failing accounts with their reasons, for example `"Kênh A: slot; Kênh B: quota"`.
- Use the account display name, not the id, in the Vietnamese message.
- The project checks (metadata, thumbnail) run once, not once per account.
- The sensitive-topic check (`sensitivePublish`) and the grant check are unchanged.

**Tests:**
- 2 accounts where the second is over its daily quota → 409, the message names the second account, and no publication is created.
- 2 accounts that both pass → 2 publications.
- Same slot on account B only → 409.

## 3. Gap 3: MCP "agent" calls skip the quality gates

**What happens now:**
- A request with header `x-vg-tool-source: agent` (`api/registry.ts`, line 28) has source `agent` ("MCP có quyền thao tác").
- In `registry/invoke.ts` (around line 89), `autonomy` is computed only when `source !== "agent"`, and `shouldCreatePending` returns `false` for `agent` (`registry/policy.ts`, line 124).
- So `ctx.autonomyRun` is `false`. `approve_gate` then approves directly and `publish_project` publishes with no gate check. An outside agent (Codex, Hermes) with this token can push a weak script or a silent render through.

**Fix:**
- Treat a call from the `agent` source like an unattended run **for the gates only**.
- Add `ctx.gated: boolean`. Set it to `true` when `autonomyRun` is true **or** `source === "agent"`.
- `approve_gate` and `publish_project` check `ctx.gated` instead of `ctx.autonomyRun` before their gate branches.
- Keep everything else for `agent` as it is today: no pending card, and no autonomy grant check.
- Calls from the web UI (the user's own click) and actions approved from a pending card are **not** gated. Check how a pending approval executes the tool (`grep -n "executePending\|approvePending" -r apps/server/src/registry apps/server/src/api`) and make sure it passes `gated: false`.
- Revise vs hold works the same for `agent` as for autopilot (section 1).

**Tests:**
- `agent` + `approve_gate` SCRIPT with a low score → revise, or hold after round 2; not approved.
- `agent` + `approve_gate` RENDER with a silent render → held.
- `agent` + `publish_project` with no thumbnail → 409.
- The same calls from the `assistant` source with the user confirming → approved (no gate).
- A pending card approved by the user → no gate.

## 4. Live check (TASK-066 §10, not run last time)

Run the server against a **new test project** (never `56374fb2-54cf-48ff-9441-2e6c653295d4`), using the mock providers if possible (`LLM_PROVIDER=mock` or the project's existing test settings; read `.env.example`, not `.env`). Then:

1. Set autonomy to full and run the pipeline until it stops at the script gate. Confirm that the gate shows a score, and that a forced low score (set `min_quality_score` to 10) leads to revise and then hold with a card in "Cần bạn xử lý".
2. Approve as the user → the pipeline continues to render. Confirm that `renders.report` has `maxVolumeDb` and `subtitlesInSync`.
3. Call `publish_project` through MCP with the `agent` header and no thumbnail → 409.

Write what you saw (commands, results, screenshots if any) in the report. If you cannot run something, say why.

## 5. User guide

- `docs/user-guide/tu-van-hanh.md`, two short points:
  - when the script fails the gate, the agent rewrites it at most 2 times, using the reasons;
  - an agent connected via MCP with write rights also has to pass the quality gates.
- One entry in `nhat-ky-thay-doi.md`.
- Update the `featureMap` only if a route or tab changes (none is expected).

## Done checklist

- [ ] The failing-first test for Bug 1 fails on the old code and passes now.
- [ ] The 3 parts have their tests. `npm run typecheck` and `npm test` pass in every workspace.
- [ ] No change in the TASK-067 folders listed at the top. No new dependency. No hand-written migration.
- [ ] The live check (§4) is done or explained.
- [ ] Report in `docs/tasks/TASK-069.report.md`:
  - what changed;
  - the mixed-account choice;
  - test counts per workspace;
  - live-check results;
  - deviations from this guide.
- [ ] An empty file `docs/tasks/TASK-069.done`.
