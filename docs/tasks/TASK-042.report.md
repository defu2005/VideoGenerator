# TASK-042 report

## What changed

- `packages/shared/src/motion/templates.ts` and `plan.ts` — nine templates, clamp/fallback graphics, overlay filter groups, cache key, telemetry env, CLI args.
- `apps/server/assets/motion/<id>/` — HTML + GSAP compositions and `meta.json`. Fonts and GSAP are copied at render time from the installed packages.
- `apps/server/src/media/motion.ts` — prepare folder, cache under `data/cache/motion`, queue of 2, 120 s kill, preview HTML. A failed graphic returns a warning and does not fail the video.
- `apps/server/src/api/motion.ts` — template list, sandboxed preview, browser install, doctor status.
- Web: Render page section **Đồ họa động**, profile checkbox **Bật đồ họa động** (default off), channel name, timeline graphic chips placed by start time, and a preview iframe of the selected template.
- `docs/THIRD_PARTY.md` records hyperframes, gsap and Be Vietnam Pro.

## CLI flags (hyperframes 0.9.14 `--help`)

```
hyperframes render <dir> --output <file> --format webm --fps 30 --workers 1 --variables-file variables.json --quality draft --experimental-fast-capture=false
```

Env: `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, `HYPERFRAMES_NO_UPDATE_CHECK=1`.

Windows uses **webm**. `mov` on this CLI is ProRes 4444, which is the non-Windows alpha path. WebM also needs `--experimental-fast-capture=false`: the default drawElement path failed on the installed Chrome with `DrawElementImage requires the canvas to have the content=drawable attribute`. Screenshot capture then succeeded. The runner puts `ffmpeg-static` and `ffprobe-static` on `PATH`. Chrome came from `HYPERFRAMES_BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe` (the first attempt tried to download HyperFrames' own browser).

## Time table

1080×1920, 2.0 s, 30 fps, draft, 1 worker, screenshot capture. Wall clock includes CLI startup. Machine: Asia/Bangkok, 2026-11-05 ~21:39.

| Template | Seconds | Result |
| --- | ---: | --- |
| title_card | 15.6 | OK |
| kinetic_word | 15.7 | OK |
| number_counter | 16.5 | OK |
| lower_third | 15.2 | OK |
| list_item | 16.1 | OK |
| quote_card | 15.1 | OK |
| bar_chart | 17.8 | OK |
| progress_bar | 16.6 | OK |
| end_card | 15.3 | OK |

Middle frames: `docs/tasks/TASK-042-frames/`. They are the captured frames (title card is a full-frame black plate with white text). They are not composited onto a checkerboard.

Cache cap: **2 GB** LRU at `data/cache/motion`.

## Tests

- `packages/shared/test/motion.test.ts` — 6 passed.
- `apps/server/test/motion.test.ts` passed earlier in the session.
- Web `EditPlanPanel` asserts `sandbox="allow-scripts"`.
- `npm test --workspaces` later passed at 23:20 (Asia/Bangkok): shared 334, mcp 14, server 649 passed and 1 skipped, web 149. The browser UI was not clicked in a browser.

## Deviations

- Trang Render có nút **Render thử** (`POST /api/motion/trial`, thẻ tiêu đề 3 giây, 540×960). Hồ sơ có lưới mẫu, màu, phông và thẻ kết. Timeline sửa đồ họa qua `PATCH /api/projects/:id/timeline/graphics`.
- Bước ghép cuối render từng đồ họa rồi phủ lên trước phụ đề. Đồ họa lỗi thì video vẫn ra, kèm cảnh báo `GRAPHIC_SKIPPED`. Nếu `kinetic_word` lỗi, phụ đề ASS thêm lại dòng Callout.
- Dự án `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` chưa được render kèm đồ họa, nên chưa có thời gian có/không đồ họa. Dự án `56374fb2-54cf-48ff-9441-2e6c653295d4` không bị đụng tới.
- Test `HYPERFRAMES_SMOKE` nằm trong `apps/server/test/motion.test.ts` và bị bỏ qua khi biến môi trường không phải `1`. Khi bật, nó render `title_card` 2 giây rồi kiểm tra pixel alpha bằng ffprobe.
- `GET /api/motion/preview` trả HTML đã nhúng biến, nút **Phát** và thanh tua `vg-seek` trên timeline GSAP `main`. Đường `../` bị 400.
- Khóa cache đồ họa vẫn là SHA-256, viết bằng JavaScript thuần để bản web không cần `node:crypto`. Vector `abc` khớp giá trị chuẩn.
- Xem nhanh 10 giây trả các đồ họa giao với cửa sổ thời gian. Timeline và chat góp ý hiện tên mẫu.
