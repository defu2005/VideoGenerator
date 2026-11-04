# External critiques of architecture v0.1 (Gemini, GPT): what we take

Both critiques were written against ARCHITECTURE v0.1, before any code. Checked against the
code on 2026-11-04 (after TASK-010).

## Already handled in code
| Point | Where |
|---|---|
| SSRF on custom URL / downloads | `imageStore` + `audioStore`: blocked hosts, DNS check, size limit, magic-byte sniff |
| Broken / partial JSON from LLM | `providers/llm/structured.ts` extracts and repairs, then zod |
| Cache key without prompt/schema version | `providers/llm/cache.ts` hashes provider, model, prompt and schema version |
| Concurrency, double "Generate All" | `WORKER_CONCURRENCY`, at most one running job per project |
| Crash recovery | RUNNING jobs go back to QUEUED on start; stages are idempotent by input hash |
| SQLite pragmas | WAL + foreign keys in `db/client.ts` |
| Review fatigue on 30–40 scenes | "Approve all", scenes needing the user are highlighted |
| Subtitle timing from duration only | Edge TTS word boundaries → per-word cues; cues editable |
| Count calls only, not cost | budget modes show estimates; token usage per video/stage/model (004I) |

## Taken into TASK-011 / TASK-012 (render)
1. **Media contract**: every scene clip has the same size, fps, timebase, pixel format
   (yuv420p) and audio format (48 kHz stereo AAC). Images are scaled to the target size before
   `zoompan`. This prevents concat drift.
2. **Transitions never change duration**: fades happen inside each clip (no overlapping
   `xfade`), so voice, subtitles and video stay on one clock.
3. **Hashes include settings**: timeline and clip hashes include resolution, fps, transition,
   music mix and a format version, not only content.
4. **Subtitles are retimed by the timeline**: the timeline writes its own ASS/SRT using real
   scene offsets (silent scenes included).
5. **Render validation**: ffprobe checks streams, size, fps and duration against the timeline
   (tolerance). Exit code 0 is not enough.
6. **Checkpoints**: clips are cached by hash and written to a temp file, then renamed. A render
   that dies halfway reuses finished clips.
7. **Loudness**: `loudnorm` on the final mix, in addition to ducking.
8. **License summary at final approval**: count of UNKNOWN / non-commercial assets is shown
   before render, and `credits.txt` lists attributions. Still a warning, never a block (user decision).

## Backlog (worth doing, not now)
- **Storage cleanup**: delete files of unselected candidates and old renders; disk usage view.
- **SSE `Last-Event-ID`** resume. Polling fallback covers it today.
- **Hard budget in money** per video (stop with `BUDGET_EXCEEDED`), on top of call limits.
- **Claim → source tracing / fact check** as a QUALITY/MAX option.

## Not taken
- **ECO with more than one call, LLM scene planning by default**: cost-first is the product rule.
  QUALITY can spend more.
- **Generic Asset entity, Job/Attempt split**: large refactors with little gain for one local user.
- **Fewer providers / vertical slice first**: the providers are built, and render is the next task,
  so the end-to-end slice is two tasks away.
