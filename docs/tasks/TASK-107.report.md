# TASK-107

`recheckOriginalitySafely` trong `apps/server/src/originality/recheckSafely.ts` gọi `recheck`, bắt mọi lỗi, `console.warn` một dòng (`projectId` + message, không stack, không secret) và trả `null`.

Chỗ gọi: `renderService.ts` (dùng lại bản render; sau khi ghi render), `timelineService.ts` (dựng lại, dựng mới, lưu kế hoạch, sửa, hoàn tác), `guidelines/service.ts` (`runCodeChecks`). `applyRetention` tách khỏi `try` của recheck nên vẫn chạy khi kiểm tra lỗi. Giữ `isBusyError` chỉ quanh `applyRetention`: hàm đó đã bỏ qua EBUSY/EPERM từng file; lớp ngoài giữ render đã xong nếu khóa file vẫn thoát ra.

Không sửa `api/originality.ts` (bấm kiểm tra lại phải thấy lỗi) và `publishing/guardrail.ts` (đăng vẫn đóng khi kiểm tra không chạy được). Task cũng cấm `publishing/`.

Độ đục: không đổi `unknownLicenseShare`. `title_card` và `end_card` có `background:transparent`. `renderMotionGraphic` xuất webm/mov. `buildFinalPlan` phủ mọi đồ họa timeline bằng overlay trong suốt. `renderService.ts` không có nhánh `fullscreen`. Mẫu compose full-scene là MP4 đục và thay cả cảnh, không phải lớp `fullscreen`.

Hướng dẫn không viết câu “thời gian dưới đồ họa toàn màn hình không tính giấy phép chưa rõ”. Đã ghi sự thật ở `dang-bai.md`, `nhat-ky-thay-doi.md` và `featureMap` (`originality`).

Kiểm tra 12/11/2026, khoảng 07:00–07:08 ICT: `npm run typecheck` gốc lỗi `packages/shared/src/style/fonts.ts:60` TS2322 (TASK-106, không sửa). `npm run typecheck --workspace @vg/server` pass. Shared 07:00: 77 file, 597 test, pass. Shared 07:07: fail `src/style/palette.test.ts` (TASK-106). Server lúc chạy song song: fail `test/antigravityCli.test.ts` (EPERM) và `test/connections.test.ts` (hook 30s); chạy lại riêng 63 test pass. `timeline.test.ts`, `render.test.ts`, `originality.test.ts`: 27 pass.

Chưa làm: công thức `covered(unknown ∪ ownTemplates) − covered(ownTemplates)` và ba test share, vì lớp fullscreen có thể trong suốt.
