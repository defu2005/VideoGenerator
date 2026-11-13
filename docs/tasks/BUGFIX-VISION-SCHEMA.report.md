# BUGFIX-VISION-SCHEMA — báo cáo

## File đã đổi

- `packages/shared/src/schemas/vision.ts` — `normalizeVisionCheckBatch` (ép issue/fit/cropOk, bỏ key thừa).
- `apps/server/src/providers/llm/structured.ts` — tuỳ chọn `normalize` ở cache, validate và repair.
- `apps/server/src/services/visionVerify.ts` — bọc batch, fallback từng ảnh, `visionBatchFailures` / `visionSkipped`, prompt schema v2.
- `apps/server/src/stages/visuals/visionPrompts.ts` — prompt ngắn, chỉ 8 issue, không field lạ.
- `apps/server/src/services/visualService.ts` — `normalize` + schema v2 ở vision-check đơn; tóm tắt stage.
- `packages/shared/test/vision.test.ts`, `apps/server/test/visionSchemaFix.test.ts` — test mới.
- `docs/user-guide/nhat-ky-thay-doi.md` — một dòng.

## Bảng đồng nghĩa issue

`blurry`, `blur`, `pixelated`, `low_resolution`, `low_res` → `low_quality`; `irrelevant`, `off_topic`, `unrelated`, `wrong_character` → `wrong_subject`; `logo` → `logo_only`; `text`, `caption`, `subtitle` → `text_overlay`; `watermarked` → `watermark`; `anachronism` → `wrong_era`. Còn lại không thuộc enum thì bỏ.

## Tóm tắt stage khi lỗi

Sau VISUAL_SEARCH, `message` thêm `· Vision: N ảnh không đọc được kết quả, cần bạn xem` khi `visionSkipped > 0`. Ảnh không có kết quả vision vẫn qua cổng `vision_missing` như TASK-077.

## Kiểm tra

- `npm run typecheck`, `npm run build`: pass.
- Test: shared **716**, mcp **19**, web **185**, server **972** pass + **5** skip trên một lần chạy đầy đủ; **3 fail** ngoài phạm vi: `apps/server/test/render.test.ts` (timeout/ffmpeg 60s + EPERM dọn temp).
- Chỉ `apps/server`: `test/visionSchemaFix.test.ts` **5/5** pass.

## Lệch spec / chưa làm

- Không lệch spec. Không commit/push (theo guide).
