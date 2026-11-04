# TASK-011 report

## Scope delivered
The TIMELINE stage puts voice, visuals, music and subtitles on one frame-aligned 30 fps clock. The FINAL_APPROVAL gate checks it, and the Timeline panel shows it. It is pure code with 0 LLM calls.

## Decisions
1. The timeline is the single source of truth for TASK-012, which only renders what the timeline says.
2. Fades stay inside each clip, with no crossfade overlap. Total duration is the sum of the scene durations, exactly.
3. A manual duration override never cuts the voice. When it would, the override is ignored and a warning is shown.
4. The timeline writes its own retimed SRT/ASS, so cues line up after silent scenes. The SUBTITLES stage output is left unchanged.
5. Missing or unapproved visuals become placeholders and a warning, not a failure. Missing voice or subtitles fails the stage clearly.
6. Licenses produce warnings plus `licenseSummary`, never a block.
7. The orchestrator AUTO path now calls `canApprove` for every gate, not only some of them.

## Checks
- `npm test --workspaces`: 494 tests pass (shared 136, mcp 10, server 282, web 66).
- `npm run typecheck`: passes.
- `npm run build`: passes. The usual chunk-size warning is still there.

## Not done / next
- TASK-012 renders from the timeline with FFmpeg:
  - clip cache by hash;
  - loudnorm and ducking;
  - ffprobe validation;
  - `credits.txt`.
