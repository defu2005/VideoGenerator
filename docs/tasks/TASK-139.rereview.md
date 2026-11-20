# TASK-139 — đánh giá lại (không phải review chính thức)

Ngày: 2026-11-19. Người thực hiện: Claude, trong phiên GOAL-2026-11-18 (advisor điều khiển). Không sửa `TASK-139.review.md` hay `TASK-139.done`. Chưa commit, chưa push.

## 1. Tính tươi của plan đã lưu (freshness): ĐẠT, có bằng chứng test

Bằng chứng chạy được:
- `npx vitest run test/preview.test.ts` (apps/server): **45/45 pass** (77 s).
- Các ca đi qua `loadPreviewPlan` thật, không inject `planLoader`, trong `apps/server/test/preview.test.ts`:
  - ảnh được thay (dòng ~382); duration/order đổi (~427); thêm/xóa cảnh (~481);
  - JSON hỏng và sai schema (~526); locked được giữ (~555); ảnh bị xóa thành PLACEHOLDER (~596);
  - bảng `cases` (~800–870): ảnh được thay, ảnh bị xóa, **chuyển động đổi**, FPS đổi, thêm visual thứ hai trong cùng cảnh, thêm graphic có chữ, đổi chữ graphic, đổi thứ tự cảnh, thêm cảnh, xóa cảnh, JSON hỏng, sai schema, thiếu sidecar, sidecar sai fingerprint. Mỗi ca assert đã dựng lại theo timeline hiện tại.
- Repro `tmp/codex-review-139-repro.ts`, `-cleared-image.ts`, `-fix2-motion.ts`: cả ba cho `reusedStalePlan: false`.
  - Ghi chú: repro `fix2-motion` in `motion: "static"` vì fixture chỉ đặt `motion`, không đặt `motionPreset` (fix3 đã ghi nhận). Test "chuyển động đổi" ở trên là bằng chứng chính cho motion, không dựa vào repro này.
- Ghi chú khi dùng fallback: `FALLBACK_NOTE` trong `apps/server/src/preview/service.ts:82`, gắn ở dòng 290 và 466.

Kết luận freshness: các finding P1 của review chính thức (ảnh đổi, duration/order, thêm/xóa cảnh, JSON/schema, cleared image) và finding fix2 (motion, graphic text) đều đã có test thật và pass. **Không còn finding freshness mở** theo bằng chứng hiện tại.

## 2. Hiệu năng: CHƯA ĐẠT, để mở

Theo `docs/cursor/TASK-139.md` dòng 40: "one frame under 3 s, a contact sheet for 10 scenes under 20 s, a 3 s clip under 15 s on the user's CPU. Measure and report the real numbers."

Số đo đã có (fix4, `TASK-139.fix4.md`):
- Đường direct (Chromium có sẵn): 8 lần lạnh, trung vị **2,26 s**, **3/8 lần vượt 3 s** (3115, 3284, 4351 ms). Đạt ở mức trung vị, không ổn định.
- Đường fallback (full-shot): 3 lần lạnh, trung vị **28,2 s** (30,2 / 27,4 / 28,2). Không đạt, gấp khoảng 9 lần.
- Review chính thức đo thêm dưới tải đồng thời: direct 32,6 s, fallback 52 s. Số này bị nhiễu bởi tải nền nên không dùng làm baseline.

Không có số đo contact sheet 10 cảnh và clip 3 s trong fix4 mới. Các mục đó chưa được đo lại trong đợt này.

Theo advisor: không tối ưu fallback trong đợt này. Việc tối ưu là task riêng.

## Kết luận

- Freshness: **đạt** (bằng chứng test ở trên).
- Hiệu năng: **chưa đạt**. Direct đạt trung vị, không ổn định. Fallback không đạt. Cần đo lại có kiểm soát tải và tối ưu phạm vi render ở task sau.
- TASK-139 vẫn **chưa được chấp nhận** cho đến khi hiệu năng đạt hoặc người dùng chấp nhận phần đã đo.
