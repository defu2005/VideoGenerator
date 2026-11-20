# TASK-139b — Preview latency on the direct path, and a decision on the fallback 

**Who:** opencode (code), Codex (review), when the user hands it over. Claude writes this guide only. **Size:** M.
**Source:** `docs/tasks/TASK-139.rereview.md` and `docs/tasks/TASK-139.fix4.md`, re-measured 2026-11-19 (numbers below).
**Depends on:** TASK-139 freshness, which is already accepted (do not reopen). Do not touch `node/*`, `providers/llm/*` or `api/llm*`.

## Why

TASK-139 is not accepted because its performance budget is not met. Budgets from `docs/cursor/TASK-139.md` ("Budget per call"):
- one frame under 3 s;
- contact sheet for 10 scenes under 20 s;
- 3 s clip under 15 s.

## What was measured (2026-11-19, Windows dev machine)

Script: `tmp/task139-preview-benchmark.ts`, run as `node_modules/.bin/tsx tmp/task139-preview-benchmark.ts direct <frame|sheet|clip>`.

**Scope of these numbers:**
- **Synthetic fixture:** 10 scenes, 7 `quote_full` shots and 3 footage shots, 640x360 test source, and an injected preview plan (not a real project).
- **Quality mode:** the default budget mode (`QUALITY`), not `BALANCED`.
- **Path:** the direct path, because the Chromium adapter is available on this machine. The fallback is used only when the adapter throws `PreviewAdapterUnavailable` (`apps/server/src/preview/service.ts`, lines 284–290 and 459–466).
- **Not measured:** the Docker image, worker nodes, and a real project with real footage. Those may take a different path (the adapter may not be present there).

| Operation | Runs | Times (ms) | Median (ms) | Budget (ms) | Result |
|---|---|---|---|---|---|
| Frame, batch 1 (run with sheet and clip) | 3 | 1881, 1792, 1829 | 1829 | 3000 | meets |
| Frame, batch 2 (new process each run) | 8 | 1659, 1742, 2083, 3449, 3213, 2857, 3344, 3491 | 3035 | 3000 | 4 of 8 over |
| Contact sheet, 10 scenes | 3 | 3464, 3766, 3550 | 3550 | 20000 | meets |
| Clip, 3 s | 3 | 5333, 5196, 5246 | 5246 | 15000 | meets |
| **Frame, controlled series 1 (cold, new process each run; load 56%→3% CPU)** | 10 | 2934 … 3949 (order: 3949, 3293, 3837, 3563, 2954, 2934, 3077, 2972, 3170, 3422) | 3232 | 3000 | 7 of 10 over |
| **Frame, controlled series 2 (cold, previews stopped)** | 10 | 2371, 2948, 2801, 3085, 2983, 2803, 3099, 3045, 2860, 2744 | 2904 | 3000 | 3 of 10 over |
| **Frame, warm (same process, 5 calls), 3 processes** | 15 (first call of each process: 3599, 3167, 2790) | 1493–1735 for calls 2–5 (12 values) | 1575 (calls 2–5 only) | 3000 | meets (steady state only) |
| **Contact sheet, controlled series 1 (cold)** | 5 | 6406, 6424, 6439, 6547, 6637 | 6439 | 20000 | meets |
| **Clip 3 s, controlled series 1 (cold)** | 5 | 7499, 7539, 7580, 8040, 8324 | 7580 | 15000 | meets |
| **Chromium alone (launch probe)** | 5 | launch 1127 (first), then 588–630; screenshot 218–255; close 240–320 | | | context only |
| Frame, earlier batch (fix4, direct) | 8 | 4351, 3284, 2521, 3115, 1992, 1863, 1869, 1885 | 2256 | 3000 | 3 of 8 over |
| Frame, fallback full-shot (fix4) | 3 | 30200, 27400, 28200 | 28200 | 3000 | does not meet (about 9x) |

Budget basis (decided by advisor, 2026-11-19): the 3 s budget applies to every call, including the first call in a process. Warm numbers are reported but do not replace it. Measured detail and the stage findings: `docs/tasks/TASK-139b.report.md`.

**Reading of batch 2:** every run was a fresh process, so per-process start-up cost does not explain why later runs are slower. The slowdown across the batch suggests background load or a change in machine state. This is not yet isolated. No run has been excluded.

## Work to do

Status as of 2026-11-19. Full detail: `docs/tasks/TASK-139b.report.md`. Decisions: `docs/tasks/GOAL-2026-11-18.decisions.md` (2026-11-19 TASK-139b entry).

1. **[done] Fallback decision.** The fallback (about 28 s) is a labelled degraded mode marked with `FALLBACK_NOTE` (`apps/server/src/preview/service.ts`, line 82). No numeric budget is set for it yet; it has not been measured on Docker or a worker. The 3 s budget applies to the direct path, including the first call in a process.
2. **[done] Controlled measurement.** Frame 10 + 10 cold runs, sheet 5, clip 5, each a new process, with load logged (`tmp/task139b-series.log`). Frame cold median 3232 ms (7/10 over) and 2904 ms (3/10 over). Sheet 6439 ms, clip 7580 ms. Load was not clean: see the report.
3. **[done] Stage cost, read-only.** Browser is started and closed per operation (`service.ts:368`), not per scene. Chromium costs about 1 s per call (launch probe). The first call in a process costs about 2 s more than warm calls (warm calls 2–5: 1493–1735 ms). The stage split inside the first call is not measured yet.
4. **[open, implementer] Move one-off cost off the first call.** Per the report's "Việc còn lại":
   - time each stage of the first call (import, `assets()`, launch, `prepare`, page build, capture, encode) before changing anything;
   - warm the once-per-process work at server start (`puppeteer-core` import, browser path lookup, `assets()`);
   - re-measure cold per process and record the numbers.
   Do not change the RENDER path. The per-call browser reuse idea is not a target: the browser is already shared across scenes within one operation.
5. **[open, implementer] Verify:** `apps/server/test/preview.test.ts` must pass, typecheck must pass, and the new numbers must be recorded. Write `docs/tasks/TASK-139b.done` only when the 3 s budget is met on the first call, or the user accepts the measured numbers. Neither is true yet.

Not verified: the stage breakdown of the remaining cost; the cause of the `lumaFlag` nondeterminism (reviewer item for TASK-139, does not block 139b).

## Open source available

| Project | Licence | Use |
|---|---|---|
| [HyperFrames](https://github.com/heygen-com/hyperframes) (already a dependency) | Apache-2.0 | Renders one template shot at a time; the direct path already uses it |
| [FFmpeg](https://ffmpeg.org/) `-preset ultrafast` and `tile` | LGPL/GPL (already used) | Clip encode and contact-sheet tiling |
| [Remotion `renderStill`](https://www.remotion.dev/docs/renderer/render-still) | Remotion licence (not added) | Idea only; see ARCHITECTURE §11 |

No dependency is added. If a maintained library would replace a large part of this, report it instead of adding it (README rule 11).

## Not allowed

- Do not relax the budgets to make the numbers pass.
- Do not run on the protected project `56374fb2-…`, and do not use `data/`. Use a fresh temp data dir, as the benchmark does.
- Do not edit `TASK-139.done` or `TASK-139.review.md`. Those belong to the reviewer.

## Done when

- The numbers table above has been extended with the controlled series, and load is recorded.
- The fallback decision is in the decisions log.
- Report at `docs/tasks/TASK-139b.report.md`, and `docs/tasks/TASK-139b.done` written only when the budgets are met or the user has accepted the measured numbers.
