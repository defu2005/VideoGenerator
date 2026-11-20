# TASK-139 — Báo cáo fix3 (ràng buộc plan đã lưu với đầu vào hiện tại)

Ngày: 2026-11-18. Chưa commit, chưa push, chưa promote. Chưa đổi dòng README; chờ Advisor review.

## Sửa gì

Theo hướng 2 đã chốt trong `docs/tasks/GOAL-2026-11-18.decisions.md`: fingerprint đầy đủ của mọi đầu vào plan, không kiểm từng trường.

- `apps/server/src/compose/planInputs.ts` (mới): `composeInputFingerprint(sqlite, project, timeline)` băm timeline, toàn bộ `project.settings`, scenes (sắp theo id) và voice tracks (sắp theo scene id), bằng sha256 trên stable stringify. Sidecar `render/compose-plan.inputs.json` = `{ v: 1, fingerprint }`, đọc/ghi qua `readPlanInputs` và `writePlanInputs`.
- `apps/server/src/services/composeBridge.ts`: `prepareComposePlan` tính fingerprint trước khi lập plan (hoặc nhận từ caller), ghi plan rồi mới ghi sidecar.
- `apps/server/src/services/renderService.ts`: tính fingerprint trước khi gọi plan, ghi sidecar sau `compose-plan.json`. Dòng sửa shot chỉnh tay (`editSavedComposeShot`) không đụng sidecar.
- `apps/server/src/preview/planSource.ts`: xóa `isSavedPlanCurrent`. Chỉ tái dùng plan khi: plan đúng schema, `aspect` khớp, sidecar khớp fingerprint hiện tại, và có plan cho mọi cảnh của timeline. Còn lại dựng lại bằng `planFromTimeline`, giữ locked shot như trước, và ghi note. Cảnh không có trong plan giờ được ghi note thay vì bỏ im lặng.
- `docs/ARCHITECTURE.md`: thêm đoạn mô tả sidecar và quy tắc tái dùng (rule 12).

## Kiểm chứng

- `npx vitest run test/preview.test.ts` (apps/server): **39/39 đạt**, gồm 15 test mới đi qua `loadPreviewPlan` thật:
  - Dương tính: plan có marker và sidecar đúng, được tái dùng, không có note dựng lại.
  - Bảng 15 đột biến, mỗi case kỳ vọng dựng lại theo timeline hiện tại, không còn marker, `project_stages` không đổi, file plan không bị ghi: ảnh thay; ảnh bị xóa thành PLACEHOLDER; chuyển động đổi; FPS đổi; thêm visual thứ hai; thêm graphic; đổi chữ graphic; đổi thứ tự cảnh; thêm cảnh; xóa cảnh; plan JSON hỏng; plan sai schema; thiếu sidecar; sidecar sai fingerprint.
- `npx vitest run test/composeRender.test.ts test/mediaPrefetch.test.ts`: **13/13 đạt**.
- Repro review:
  - `tmp/codex-review-139-repro.ts`: `reusedStalePlan: false` (trước: true).
  - `tmp/codex-review-139-cleared-image.ts`: `reusedStalePlan: false` (trước: true).
  - `tmp/codex-review-139-fix2-motion.ts`: `reusedStalePlan: false`. Đã sửa cách kiểm trong script: trước đây script coi `motion === "static"` là tái dùng, nhưng dựng lại cũng cho static. Nay script kiểm `reason === "previous render"`. Ghi chú: fixture chỉ đặt `motion` mà không đặt `motionPreset`. Pipeline thật đặt `motionPreset` cùng lúc (`timelineService.ts:349`), nên kết quả static là do fixture, không phải lỗi của fix.
- Typecheck `apps/server`: **3 lỗi, không nằm trong file fix3**: `scriptService.ts:629` (`blocking_facts`), `storyEngine.ts:383` (`hookRoute` ×2). Không có lỗi nào ở `planInputs`, `planSource`, `composeBridge`, `renderService`, `preview`. Log: `scratchpad/typecheck-fix3.log`. Các lỗi này có vẻ đến từ phần việc dở của agent khác, chưa xác minh.

## Cập nhật sau review Advisor (cùng ngày)

- **Thu hẹp settings:** fingerprint không còn băm `stageTimeouts`, `onOverdue`, `agentWaitMinutes`, `stageExecution`, `knowledgeRev`, `formatReason`, `userSet`. Đây là danh sách `runtimeSettings` có sẵn trong `pipeline/inputVersion.ts` (đã export). Lý do: `knowledgeService`, `stageTimeoutOverrides`, `stageTimeoutPlan` và `projectRunner` ghi các khóa này trong lúc chạy, nên nếu băm cả chúng thì plan sẽ bị dựng lại sau mỗi lần chạy. `format` và `treatment` vẫn trong fingerprint vì planner đọc chúng.
- **Ghi plan lần đầu (writer → reader):** thêm test chạy `prepareComposePlan` thật (chỉ rule director, không LLM, không mạng), rồi `loadPreviewPlan` đọc lại: sidecar tồn tại và không có ghi chú dựng lại.
- **Bảng đột biến DB:** thêm narration đổi, voice words đổi, ngôn ngữ đổi (phải dựng lại), và knowledgeRev đổi (phải tái dùng).
- **Mutation:** bỏ mệnh đề `readPlanInputs(renderDir) === fingerprint` trong `planSource.ts`: 13 trường hợp dựng lại thất bại, nghĩa là fingerprint đang quyết định việc tái dùng. Đã khôi phục mệnh đề. Đây là bằng chứng mới.
- **Kết quả sau cập nhật:** `preview.test.ts` + `composeRender.test.ts` + `mediaPrefetch.test.ts` = **57/57 đạt**. Typecheck vẫn 3 lỗi ngoài file fix3 (exit 2).
- **Writer khác:** grep `compose-plan.json` trong `apps/server/src`: chỉ `composeBridge.ts` và `renderService.ts` ghi plan kèm sidecar. `editSavedComposeShot` (composeBridge:488) ghi plan có sửa shot tay mà không ghi sidecar, đúng ý: sidecar vẫn khớp đầu vào gốc nên bản sửa tay được giữ.
- **Ảnh hưởng đến dự án cũ:** mọi plan lưu trước fix3 không có sidecar, nên dự án cũ đi đường chậm (~25 s) tới khi render lại một lần. Fix3 làm đường chậm xảy ra thường hơn ở giai đoạn này.
- **Changelog:** đã thêm mục TASK-139 vào `docs/user-guide/nhat-ky-thay-doi.md` (rule 12). ARCHITECTURE đã cập nhật danh sách băm.
- **Trạng thái:** freshness đã sửa (P1); hiệu năng còn mở (chưa đạt 3 s). Không đánh dấu TASK-139 hoàn thành trong README.

## Chưa làm / giới hạn

- Hiệu năng fallback chưa đo lại trong vòng này. Quyết định 3 trong decisions: không tối ưu, chỉ ghi số kèm điều kiện tải. Số review cũ: fallback 25,023 s; chưa đạt 3 s.
- Fingerprint hash `project.settings` trừ thiết lập chạy. Đổi một thiết lập planner-visible không liên quan vẫn làm dựng lại plan. Chọn bên an toàn.
- Plan variant theo tỉ lệ khung (render với `aspectRatio` khác) ghi đè plan chính và sidecar. Preview của tỉ lệ chính khi đó dựng lại. Đúng hướng an toàn, chưa tối ưu.
- Chưa kiểm chứng rằng 15 đột biến đều fail trên code cũ. Test dương tính đã đạt trên code mới.
- Chưa chạy lại browser/cold benchmark. Chưa đo lại `tmp/task139-preview-benchmark.ts`.

## Xin Advisor review

Các điểm cần xác nhận: (1) fingerprint hash cả `settings`; (2) thứ tự ghi plan rồi sidecar; (3) bảng đột biến có đủ phủ P1 của review hay chưa; (4) có chấp nhận đóng P1 freshness hay không khi fallback vẫn chậm.
