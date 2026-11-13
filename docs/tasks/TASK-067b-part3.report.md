TASK-067b PART 3 REPORT
status: done
files: packages/shared/src/compose/ (new footage.ts + footage.test.ts, index.ts exports); apps/server/src/compose/ (composeService.ts, eval/runEval.ts);
  apps/server/test/ (new composeFootageRank.test.ts; composePlan.test.ts and composeDirector.test.ts: one line each, see below); docs/compose/EVAL.md
tests: 25 new (16 shared, 9 server), all pass | full npm test: shared 550, mcp 19, web 181 ok; server 891 pass + 3 skipped, and 4 non-compose files
  (projects, clips, tiktokPublisher, webImageSearch) timed out in the full run while the machine was also rendering for RESEARCH-075; the 4 files pass
  when run alone (58/58) | typecheck ok
eval (VG_COMPOSE_EVAL=1, 160×90, real HyperFrames; shots/min | entropy | max run | still | off-topic footage shots | render s/min):
  explainer 16:9  rule 22.8 | 1.67 | 2 | 29% | 2/6 | 79.4     compose 22.8 | 1.67 | 2 | 29% | 0/6 | 65.9     baseline 6.4 s/min
  listicle  9:16  rule 31.7 | 1.53 | 2 | 31% | 6/8 | 108.9    compose 28.0 | 1.55 | 2 | 36% | 0/7 | 127.9    baseline 8.7 s/min
  story     16:9  rule 22.8 | 1.25 | 2 | 23% | 3/6 | 443.0    compose 22.8 | 1.25 | 2 | 23% | 0/6 | 56.6     baseline 23.0 s/min
  All four targets are met in every compose row. `compose` = rule director + ranked footage; the three older rows take clips in provider order.
  Render times are noisy (another render job shared the CPU; "story rule 443" is that, not a regression). Compose costs about the same as rule.
  Eval fixtures changed: each scene has English queries and 3–6 Pixabay-style clips with a hand label on/off-topic (new column). Beat-cut % is still "–".
decisions:
- Relevance = mean of (share of the query's words the clip carries) and (share of the clip's tags that are about the queries, full at 3 tags).
  Query coverage alone let "waterfall, water, nature" pass for "glass of water"; with 3 tags per clip the tag side is what separates them.
- FOOTAGE_MIN_SCORE = 0.45, applied to relevance × shape (0.75 if the orientation is wrong) × resolution. On my 80 labelled clips (20 scenes)
  0.45 makes no error; 0.40 keeps 5 off-topic clips, 0.50 drops 5 good ones. The margin is thin (best off 0.43, worst on 0.47) and I wrote both
  the labels and the formula, so this needs a check on real Pixabay results.
- Clip length and author only order the hits: clip ≥ shot + 1 s is preferred, a clip shorter than the shot is left out, a 3rd clip by one author × 0.8.
- inSec: 0.5 for the first shot; a second shot from the same clip (only when the scene has no unused clip) starts at duration − 0.5 − length and
  must begin ≥ 1 s after the first part ends. A clip is never used in two scenes or more than twice.
- Clips found by several scenes are shared in rounds (best fit wins a tie), ≤ 6 per scene, so one scene cannot take them all.
- No usable clip → the scene gets no footage and the director plans stills; a footage shot with no clip at fill time becomes a still, reason "+F-still".
- Still shots in a row that show the same image are merged into one shot (a cut to the same image only restarts its motion). This is what
  keeps max run ≤ 2 in a scene without footage; that scene is then one long still (6 s in the listicle).
- Pacing bands, cut cost weights and variety limits are unchanged: every target passes and the eval has no beat grid to tune cut costs against.
old tests changed (intended): composePlan "inSec === 0.5" → "shot ends inside the clip"; composeDirector plan query "scene-N" → "city scene-N" (clips are tagged "city").
067a issues:
- An 8 s clip on an 8 s shot used inSec 0.5 and froze the last half second; now inSec 0.
- node_modules: an `npm install` at 10:12 today, run from Linux, replaced the Windows native packages, so vitest could not start. I added
  @rollup/rollup-win32-x64-msvc 4.67.4 and @esbuild/win32-x64 (0.18.20, 0.25.12, 0.28.2), hashes checked against package-lock.json. Nothing removed;
  package.json and the lockfile untouched. @img/sharp is still Linux-only.
for TASK-068/070:
- composeBridge should pass `targetShortSide: shortSide` to planProject; without it resolution is not scored.
- composeBridge limits each search to 6 hits; ranking can use up to 18 per scene over 4 queries, so raise `limit` to about 12.
- Log `footageRelevance` for chosen and dropped clips in the plan report on the first live runs, to check the 0.45 threshold on real tags.
- A scene without matching footage is one long still. 070 should give such scenes a second image or a graphic.
- docs/compose/README.md does not list footage.ts (`rankFootage`, `assignFootage`, `pickInSec`) or `planEval` (outside my allowed files).
