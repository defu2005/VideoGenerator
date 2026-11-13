# TASK-113 — Style 6: visual sameness feeds the originality check 👯

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** S. **Migration:** probably none; `video_looks` exists. If you need a column, use drizzle-kit only. **New dependency:** none.

## Why

YouTube's "inauthentic / mass-produced content" policy hurts channels whose videos all look the same.
- TASK-109 already stores a `VideoLook` per finished render in `video_looks`: style fingerprint, shot-kind mix, variant combos and frame hashes.
- `packages/shared/src/style/sameness.ts` already scores two looks (`visualSameness`, `compareVisualSameness`, `visualSamenessIssues`) for the same channel and across channels.

Nothing calls those scores yet. This task adds them to the originality report from TASK-084, so the user and the agent see it before publishing.

## Read first

- `packages/shared/src/style/sameness.ts`: the whole file, including `VisualSamenessSettingsSchema` and its defaults.
- `apps/server/src/originality/{service,manifest,recheckSafely,toolDefs}.ts` and the TASK-084 and TASK-107 reports. TASK-107 says a recheck error only logs, and must never block a step.
- `apps/server/src/style/{service,recordSafely,frames}.ts`: when the look is written, which is after the render, next to the originality check.
- The `video_looks` table in the DB schema.

## Build

1. In `originality/service.ts`, after the look for this render is saved:
   - load the earlier looks. For the same channel, take the last N renders, with N from the settings window; across channels in the same workspace, take the last M looks;
   - run `compareVisualSameness`, then `visualSamenessIssues`;
   - add the result as a new **signal** in the originality report: `visualSameness` with the channel score, the cross-channel score, the parts (combos, frames, kinds, style) and the closest earlier video, with its project id and title.
2. Severity follows the existing originality rules:
   - an issue at `warn` shows in the report and the review gate;
   - at `block` level, which the settings define, it moves the project to manual review, like the other originality failures do.

   Follow TASK-107: an error while computing only logs a warning and never blocks a step.
3. Settings: expose `VisualSamenessSettings` (thresholds and windows) in the existing originality settings, with the shared defaults. A user may raise or lower them; the agent may not. They are not registry params yet; TASK-088 moves them later.
4. **UI:** the originality panel in the project review shows a "Độ giống video trước" row with the score, the closest video (link) and the part that drives it (for example "cùng tổ hợp biến thể với 3/5 video gần nhất").
   - Add a hint to fix it: "Đổi biến thể hoặc pack trong tab Phong cách". If TASK-111 has landed, link that tab.
5. **Tool:** extend the existing originality read tool's output with the new signal. Add no new tool.

## Mã nguồn mở có sẵn (open source)

- The scoring is already written: it is ours, built on dHash from `packages/shared/src/visuals/phash.ts`. Nothing new to adopt.
- **imagehash** (BSD-2, Python) and **blockhash-js** (MIT) are the references for perceptual hashes, if you need to check the dHash threshold `PHASH_NEAR_MAX`. Do not add them.

## Rules

- README rules 1–11. Do not change `sameness.ts` scoring unless a test proves a bug; report it instead.
- Do not edit `visuals/`, `compose/director/` or the TASK-125 and TASK-119 files.

## Tests

- two near-identical looks in one channel produce a warn issue in the report;
- different looks produce no issue;
- the cross-channel case;
- a missing look, or a look with empty frame hashes, still produces a report, using the parts it has;
- a compute error only logs;
- block level sends the project to manual review;
- web: the panel shows the row and the link.

## Docs

The originality section of the user guide gets a "độ giống nhau" entry. Add a changelog bullet.

## Done

- [ ] signal in the originality report; severity and review routing
- [ ] settings + UI row + tool output
- [ ] tests; typecheck, server and web suites
- [ ] user guide + changelog
- [ ] report `docs/tasks/TASK-113.report.md` with real scores for the last renders in the dev DB (read-only), then `docs/tasks/TASK-113.done`
