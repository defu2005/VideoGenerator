# TASK-021B — Cursor guide (fixes from live AUTO run 2: edge-tts retry, NASA image URLs)

Read `docs/cursor/README.md` first. There is no spec in `docs/tasks/`: this guide is the spec. Small task: two independent fixes, each in one file plus its tests.

# Part 1: sturdier edge-tts retry

## Problem (from the live AUTO run)
The VOICE stage failed with `TTS_NO_AUDIO` at scene 11/26. Microsoft's edge-tts service sometimes returns `NoAudioReceived` for one sentence with `vi-VN-HoaiMyNeural`. A probe showed:
- the same sentence failed for about 20–40 s, then worked again with no change;
- the same sentence with `--pitch=+1Hz` worked at once.

`apps/server/src/providers/tts/edgeTts.ts` waits only 2 s, 5 s, 10 s between 4 attempts, so it gives up before the service recovers.

## Change (only `edgeTts.ts` and its test file)
1. **Longer backoff:** 6 attempts in total; waits between them `[3000, 10000, 20000, 40000, 60000]` ms (put the list in a named constant). Keep using `this.dependencies.sleep` so tests stay instant. Keep checking `signal.aborted` before each attempt and after each wait.
2. **Pitch nudge on retry:** attempt 1 uses no `--pitch` argument (as today). Later attempts pass `--pitch` cycling through `+1Hz`, `-1Hz`, `+2Hz`, `-1Hz`, `+1Hz` (inaudible changes that make the service take a different path). Keep the same voice and rate.
3. **Error message:** `StageError("edge-tts không trả về âm thanh sau 6 lần thử (dịch vụ Microsoft tạm lỗi). Thử lại bước Giọng đọc sau ít phút.", "TTS_NO_AUDIO", true)`.
4. Log one line per retry with the scene file name, the attempt number and the pitch used (no text content).
5. Nothing else changes: same voice, no voice fallback, no new dependency.

## Tests (fake spawn, fake sleep; no network, no real edge-tts)
- Fails twice with NoAudioReceived, then succeeds: 3 spawns, sleeps `[3000, 10000]`, the 2nd call has `--pitch +1Hz`, the 3rd `--pitch -1Hz`, the 1st has no `--pitch`.
- Always NoAudioReceived: 6 spawns, 5 sleeps with the full list, then `TTS_NO_AUDIO` with the new message.
- Abort during a wait stops at once (AbortError, no more spawns).
- An error that is not NoAudioReceived still throws at once (no retry), as today.

# Part 2: NASA image URLs (`apps/server/src/providers/images/nasa.ts`)

## Problem
In the same run every NASA candidate download failed with HTTP 403 (14 images over 4 scenes; one scene had to reuse a neighbour's image). The provider builds `imageUrl` by guessing: it replaces `~thumb` with `~large` in the preview URL. Each NASA item only has some sizes (`~thumb`, `~small`, `~medium`, `~large`, `~orig`), and NASA's storage returns **403 for a size that does not exist**. Checked live: one item had `~large` but no `~orig`, another had only `~thumb` and `~orig`.

## Change
The search response already lists the sizes that exist: each entry of `item.links` has `href`, `rel` (`preview` | `alternate` | `canonical`), `render`, and, in current responses, `width`, `height` and `size` (bytes).
1. Build `imageUrl` only from `item.links` entries with `render === "image"`. Never guess a URL.
2. Pick the best one: prefer the smallest image whose longer side is ≥ 1920; otherwise the largest one available. Skip entries above 25 MB (`size`). When `width` is missing, rank by the suffix: `~large` > `~medium` > `~orig` > `~small` > `~thumb`.
3. Use the chosen entry's real `width`/`height` instead of the fixed 1280×720. When they are missing, keep 1280×720.
4. `previewUrl` stays the `rel === "preview"` link (or the smallest image).
5. If the only image is smaller than 640 px on its longer side, drop the item (too small for 1080p).

## Tests (fixture JSON, no network)
Use a fixture with the three shapes seen live:
- `~medium`, `~small`, `~thumb`, `~large` all listed with sizes → picks `~large` with its real size.
- only `~thumb` (preview) and `~orig` (canonical, 232×232) → item dropped as too small.
- links without `width` → picks by suffix order.
- no URL in the result contains a size that was not listed in `links`.

## Steps
1. Part 1 code + tests; Part 2 code + tests.
2. Done checklist from the README (build, typecheck, all vitest suites). No browser check needed; Claude does the live check. Write `docs/tasks/TASK-021B.report.md` and `docs/tasks/TASK-021B.done`.
