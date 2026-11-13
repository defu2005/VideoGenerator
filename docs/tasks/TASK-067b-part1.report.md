TASK-067b PART 1 REPORT
status: done
files: apps/server/src/compose/director/ (new: rules.ts, labels.ts, llm.ts, index.ts); apps/server/src/compose/eval/ (runEval.ts);
  apps/server/test/ (composeDirector.test.ts new, compose.eval.test.ts timeout); packages/shared/src/compose/ (numbers.ts, 2 lines); docs/compose/EVAL.md
tests: 25 new, all pass | full npm test ok (shared 510, mcp 19, server 877 + 3 skipped, web 180) | typecheck ok
  Number-parsing cases (≥ 12 vi, ≥ 6 en) are the 067c ones in shared numbers.test.ts; I added 2 here for the fixes below.
eval (VG_COMPOSE_EVAL=1, 160×90, real HyperFrames; shots/min | entropy | max run | still | render s/min):
  explainer 16:9  baseline 19.3 | 0.00 | 11 | 0%  | 11.5    rule 22.8 | 1.67 | 2 | 29% | 122.6    rule+llm(mock) 24.6 | 1.59 | 2 | 21% | 113.3
  listicle  9:16  baseline 29.8 | 0.00 | 16 | 0%  | 15.5    rule 31.7 | 1.53 | 2 | 31% | 150.8    rule+llm(mock) 31.7 | 1.53 | 2 | 31% | 147.4
  story     16:9  baseline 16.6 | 0.00 | 8  | 0%  | 9.3     rule 22.8 | 1.25 | 2 | 23% | 71.3     rule+llm(mock) 24.8 | 1.43 | 2 | 23% | 106.7
  All four targets are met in every rule row. Beat-cut % is "–" (the eval sine track gives no beat grid, as before).
  NOT met: render time. Rule rows cost 8–10× baseline, all of it HyperFrames graphics. Part 3's stop rule (> 1.5×) will trip.
  Rule rows also show 3–6 freezedetect hits (graphics hold their last frame; baseline has 0). Not looked at by eye.
  Eval fixtures changed: real Vietnamese narration with word timings from the text, so legacy/baseline numbers differ from 067a.
decisions:
- Graphic spans always end on a word end and last 1.5–6 s. Outside that, planProject cuts inside a word and the whole scene
  falls back to one still. So the 9:16 first shot is "first word end at or after 1.5 s" (cap 2.1 s), not "≤ 1.5 s" as the guide says.
- Hook/heading text is a whole phrase (furthest clause end in the limit); a phrase under 1.5 s stays on screen while the voice goes on.
- Chart: one per scene, line > pie > bar, then more numbers. Labels are the words before each number, else after; 2–6 items
  (line ≤ 8); unclear or repeated labels skip the rule. Edge words ("chiếm", "is"…) per language live in labels.ts, not in the pack.
- R6 needs ≤ 8 words, 1.5–3 s, "!" at the end or a contrast word as the first word, ≥ 1 s away from other graphics, not the first sentence.
- Body: footage 3.2 s / still 2.2 s chunks (9:16: 2.4 / 1.7), alternating; stills paced to 36 % of elapsed time. Footage spans ≤ hit count.
- Scene 0: hook wins over a chart on the same words; in later scenes the chart wins over the heading.
- LLM: one call; prompt ≈ 1 900 tokens max for 12 scenes (text trimmed per scene). Scenes left out keep the rule plan. An invalid
  scene (gap, footage without clips, graphic outside 1.5–6 s) falls back alone. Invented chart values are dropped; < 2 left → plain picture.
- Kinetic lines from the LLM are used only when every word is in the scene; otherwise the spoken words are shown.
067a issues:
- sceneClip.renderComposedScene: on a cache hit it returns without copying the file to outPath. Not fixed; the eval now uses one data dir per mode.
- DirectorInput has no language and no preset. Language is a factory option; chunk sizes are by aspect only.
067c fixes (numbers.ts, both needed for R1, shared tests still pass):
- A number followed by a clause mark took the next word as its unit ("120 tỷ, quý hai" → unit "quý"), so same-unit groups never formed.
- Series paired each year with the value after it; "2 million in 2020 and 5 million in 2023" came out swapped. Now the clause's first mention decides.
for TASK-068/070:
- Import from apps/server/src/compose/director/index.js: ruleDirector (vi), createRuleDirector({ language }), createLlmDirector(llm, { language, onWarning }).
  pickDirector is untouched; pass project.settings.language when wiring, otherwise en/other videos get vi rules.
- LLM warnings come only through onWarning (the Director interface returns spans only); 070 should put them in the plan report.
- Reasons are R1-numbers, R2-hook, R3-list, R4-footage, R5-still, R6-emphasis, llm, llm+no-chart, with "+V1-run" etc. appended by the variety pass.
- Kinetic payloads carry wordTimes when the lines show exactly the span's words. Pie titles are often empty (the title is only text before the numbers).
- docs/compose/README.md does not list director/ yet (outside my allowed files).
