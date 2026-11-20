# TASK-139 — Báo cáo fix4 (kiểm chứng lại fix3 và đo hiệu năng)

Ngày: 2026-11-18. Chưa commit, chưa push, chưa promote. Không đụng `TASK-139.done` và `TASK-139.review.md`.

## Kiểm chứng freshness (fix3 giữ nguyên, không sửa thêm)

- `npx vitest run test/preview.test.ts test/composeRender.test.ts test/mediaPrefetch.test.ts` (apps/server): 57/57 đạt.
- Repro của reviewer, log sau sửa `tmp/codex-review-139-repro-after.log`: `reusedStalePlan: false` (ảnh đổi).
- Hai repro còn lại (cleared-image, fix2-motion) đã ghi `reusedStalePlan: false` trong fix3. Không chạy lại trong vòng này.
- Thứ tự ghi: `clearPlanInputs` trước khi ghi `compose-plan.json`, sidecar ghi sau. Test `apps/server/test/planInputsOrder.test.ts` chỉ kiểm tra helper `clearPlanInputs` (xóa sidecar, `readPlanInputs` trả null). Không kiểm tra toàn bộ luồng ghi của `composeBridge.ts` và `renderService.ts`. Ghi nhận giới hạn này, không chặn đóng freshness.
- Thiết kế: fingerprint sidecar `render/compose-plan.inputs.json` (`{v:1, fingerprint}`), xem fix3.

## Hiệu năng

Điều kiện: Windows, không chạy việc nặng khác trong lúc đo (không kiểm soát tải nền đầy đủ), fixture 10 cảnh, 7 quote animation, 3 cảnh footage, mỗi lần dùng thư mục dữ liệu rỗng mới. Script: `tmp/task139-preview-benchmark.ts`.

### Đường direct (adapter Chromium có sẵn qua HyperFrames)

8 lần lạnh liên tiếp, log từng lần:

| Lần | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| ms | 4351 | 3284 | 2521 | 3115 | 1992 | 1863 | 1869 | 1885 |

- Trung vị: **2,26 s** (2256,5 ms).
- Số lần trên 3 s: **3/8** (3115, 3284, 4351).
- Năm lần cuối ổn định quanh 1,9 s. Ba lần đầu chậm hơn, nguyên nhân chưa xác định (có thể do cache đĩa và tải nền của máy, chưa đo riêng).

### Đường fallback (legacy full-shot)

3 lần lạnh: 30,2 / 27,4 / 28,2 s, trung vị 28,2 s. Không đạt mục tiêu 3 s, gấp khoảng 9 lần.

### Kết luận hiệu năng

- Đường direct: trung vị 2,26 s đạt mục tiêu 3 s. Nhưng 3/8 lần vượt 3 s, nên chỉ đạt ở mức trung vị, không đạt ổn định.
- Đường fallback: không đạt.
- Theo `docs/cursor/TASK-139.md:40` (Budget per call) và `TASK-139.md` dòng review 25, một mục tiêu chưa đạt phải ghi vào báo cáo. Không nới ngưỡng, không thêm dependency, không tải browser.
- Chưa đo lại với tải được kiểm soát và chưa đo trên thư mục bản sao thật của dự án.

## Sửa tài liệu

- Số 25 s "không có sidecar" trong báo cáo cũ là sai. Test không có sidecar chạy ~0,3 s kể cả setup. 25–30 s là thời gian của đường fallback render, không phải của plan thiếu sidecar. Đã sửa trong decisions file. Cần kiểm tra changelog và `docs/ARCHITECTURE.md` để xóa câu tương tự nếu có.
- Báo cáo fix4 cũ ghi trung vị 3,284 s và "adapter chưa xác minh". Đã thay bằng số 8 lần và trạng thái hiện tại ở trên.

## Trạng thái

- Freshness (P1 stale plan): đã sửa, có test qua `loadPreviewPlan`. Đề xuất đóng P1 freshness.
- Hiệu năng: **chưa đạt** đường fallback; direct đạt trung vị nhưng không ổn định. Mục này để mở, ghi rõ.
- Chưa làm: browser/cold benchmark với tải kiểm soát; 15 đột biến trên code cũ; repro cleared-image và fix2-motion chạy lại.
