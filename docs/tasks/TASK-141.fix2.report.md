# TASK-141 fix2 — ghi chú đối chiếu review, 2026-11-19 (goal, advisor điều khiển)

Trạng thái: đã kiểm chứng cục bộ, **chưa review lại**. Không commit, không push, không `.done`, không sửa `TASK-141.review.md`. Thay đổi trong working tree có sẵn từ phiên trước; không rõ nguồn cụ thể, không revert.

## P1 pacing đo cảnh thay vì shot — đã có trong working tree
- Repro `tmp/codex-review-141-pacing.ts` (trước: `tmp/codex-review-141-pacing.log`, có finding `pacing` và `estimatedPacing:false`). Hiện tại: `findings: []`, `estimatedPacing: true`. Repro đã đổi kết quả.
- `continuity/check.ts`: shot chỉ lấy từ compose plan đã kiểm chứng (`getValidatedComposePlan`); không có thì không truyền shot. Voice không còn được coi là nhịp cắt.
- `packages/shared/src/schemas/continuity.ts` `continuityFindings`: pacing chỉ xét `shots`, mỗi cảnh tối đa một finding.
- `visualService.ts::continuityRank`: dùng shot đã kiểm chứng trung bình; không có thì trung tính, không phạt ứng viên.
- Test `apps/server/test/continuity.test.ts`: ca "without validated shots…", "voice tracks…", "pacing findings come only from a validated compose plan…" (một cảnh 20 s lệch bị gắn, cảnh bốn shot 5 s không bị gắn), "7.4s scene with no validated shots…".

## P2 đầu vào sửa cho TASK-121 — đã nối
- `visualService.ts::repairContinuityFindings` gọi `checkContinuity` không có context (không gọi model, không ghi báo cáo).
- `operator/qualityRepair.ts:459`: nhánh VISUALS lấy `continuityFindings` và đưa vào `diagnose` (dòng 188).
- Test `apps/server/test/qualityRepair.test.ts` (dòng ~207, ~225, ~247): finding đi vào đầu vào sửa VISUALS.
- Giữ nguyên cổng grant, budget, audit, manual-pick và relevance. Chưa đổi file operator ngoài phạm vi.
- Đường production: `defaultVisuals(ctx)` (`qualityRepair.ts:559`) trả về instance `VisualService`, nên `repairContinuityFindings` có mặt ở production.

## Bằng chứng
- `npx vitest run test/continuity.test.ts test/qualityRepair.test.ts test/scenePlan.test.ts`: 3 file, 46/46 pass.
- `npx tsc --noEmit` (apps/server), không pipe: exit 0.
- Full `apps/server` `npx vitest run`: 243 file pass, 4 skipped; 1953 test pass, 8 skipped; exit 0.
- `apps/web` `npx tsc --noEmit`: exit 0.
- `packages/shared` `npx vitest run`: 98 file, 788 test pass, exit 0.
- `apps/web` `npx vitest run`: 89 file, 242 test pass, exit 0.
- Chưa làm (giữ mở, sẽ làm một lượt cho mọi task UI sau khi xác định thư mục dữ liệu của cấu hình dev): kiểm tra trình duyệt cho màn hình visual review và "Định hướng hình ảnh". Không có dev server chạy.
- Không dùng `vitest -u`. Snapshot có thay đổi của người khác, không cập nhật.
- **2026-11-19, kiểm tra trình duyệt bị chặn:** web dev chạy ở `localhost:5180` (proxy `/api` tới `127.0.0.1:3001`, không có override trong `.env.dev`). Mọi trang đều chuyển tới `/login`, cần email và mật khẩu của tài khoản dev. Không có tài khoản dev nào trong seed hay fixture của dự án để dùng. Không đoán mật khẩu, không đổi auth, không reset mật khẩu. Cần người dùng cung cấp tài khoản test cho `data-dev` hoặc duyệt chạy `npm run reset-password` có kiểm tra DB đích. Kiểm tra này vẫn mở.


## Đối chiếu lại 2026-11-19 (chỉ phần code)
- Repro `tmp/codex-review-141-pacing.ts` chạy lại: `findings: []`, `estimatedPacing: true`, `composeShotsAvailable: false`. P1 đã sửa: không còn gắn pacing từ độ dài cảnh khi chưa có shot đã kiểm chứng.
- `continuityRank` (`apps/server/src/services/visualService.ts:170`): dùng trung bình span của shot đã kiểm chứng; không có thì dùng nhịp đích của plan, giống nhau cho mọi ứng viên nên trung tính. Quyết định: ảnh tĩnh không có thời lượng riêng, nên "thời lượng theo từng ứng viên" chỉ có nghĩa khi đã có ánh xạ shot→ứng viên. Chưa có ánh xạ đó, nên giữ trung bình. Ghi nhận như một điểm review cần người review đồng ý.
- Test `continuity`, `qualityRepair`, `scenePlan`: 3 file, 46/46 pass (chạy lại).
- Marker `docs/tasks/TASK-141.done` có 19 byte ("TASK-141 completed"). Không sửa vì fix2 report yêu cầu không đụng `.done`; cần quyết định về quy ước marker.
- Kiểm tra trình duyệt vẫn mở: `data-dev/app.db` có 0 project, 0 cảnh, 0 visual, 1 user. Không có dữ liệu để kiểm tra màn hình visual review hay "Định hướng hình ảnh". Login không giải quyết được việc này. Muốn kiểm tra thì cần seed dữ liệu cho dev, việc này chưa được duyệt.
- Trạng thái: code đã xác minh; ACCEPTED chưa đủ vì kiểm tra trình duyệt chưa thể chạy.
