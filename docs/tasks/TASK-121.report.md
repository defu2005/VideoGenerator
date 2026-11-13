# TASK-121 — Tự sửa chất lượng: báo cáo

## Đã làm
Khi hồ sơ có quyền `retries`, cổng kịch bản, ảnh cảnh (`VISUAL_REVIEW`) và render do `approve_gate` xử lý bằng vòng sửa trong code thay vì `recordHeld` + yêu cầu người dùng. Với `off`/`assist` đường cũ giữ nguyên. Cổng, ngưỡng, giới hạn cứng không đổi; dự án được bảo vệ bị từ chối.

### File
- Shared: `schemas/autonomy.ts` (RepairSettings, `defaultRepairSettings`, `scriptGateDecision(input, maxRevise)`, TOOL_GRANTS cho 3 tool), `repair/quality.ts` (mới: hành động, loại lỗi, thang mặc định, thứ tự theo thống kê), `enums.ts` (SHELVED), `schemas/llm.ts` + `providerIntel/routing.ts` (task `operatorRepair`), `schemas/vision.ts`, `schemas/render.ts` (freezeAtSec/blackAtSec), `features/featureMap.ts`, `index.ts`.
- Server: `operator/qualityRepair.ts` (diagnose, chọn, chạy, ngân sách, shelve, breaker, reopen), `operator/repairActions.ts` (3 tool mỏng), `operator/repairDigest.ts`, sửa `operator/autonomy.ts`, `operator/autopilot.ts` (digest `shelved`), `operator/qualityGates.ts` (gợi ý một lần cho SCRIPT), `registry/policy.ts` (khoá `repair`), `assistant/tools.ts` (approve_gate + `repair_script`, `repair_scene`, `repair_render_stage`), `services/visualService.ts` (hàm `repair*`), `services/composeBridge.ts` + `renderService.ts` (giờ đứng hình/đen), `pipeline/orchestrator.ts` (`runStageThenContinue`), `stages/script|research/*Executor.ts` (đọc gợi ý), `providers/llm/mock.ts`, `api/autonomy.ts` (log, active, reopen), `db/schema.ts` + migration `0066_bitter_electro.sql` (chỉ bảng `quality_repairs`; lần generate thứ hai: "No schema changes").
- Web: `AutonomySettingsPanel.tsx`, `QualityRepairPanel.tsx` (mới), `ProjectDetailPage.tsx`, `DashboardPage.tsx`, `StatusBadge.tsx`, `ProjectFilters.tsx`, `index.css`.
- Docs: `tu-van-hanh.md`, `du-an-va-quy-trinh.md`, `nhat-ky-thay-doi.md`.
- Test mới: `apps/server/test/qualityRepair.test.ts` (16), `packages/shared/test/repairQuality.test.ts` (5). Sửa có chủ ý: `packages/shared/test/llm.test.ts` 34 → 35 task.

## Bảng hành động đã cài
| Lỗi | Thang mặc định (rẻ → đắt) |
|---|---|
| script_score / script_guideline | revise_script → revise_script_stronger_model → new_angle |
| script_facts | revise_script → rerun_research_then_script → stronger → new_angle |
| scene_vision_missing | vision_recheck → pick_next_candidate → research_scene → web_search_scene → rephrase_scene_visual → switch_shot_type |
| scene_vision_reject, scene_low_relevance, freeze, black | pick_next_candidate → research_scene → web_search_scene → rephrase → switch_shot_type |
| scene_source_risk | pick_next_candidate → research_scene → rephrase → switch_shot_type (không web) |
| audio_silent | rerun_voice → rerun_music |
| subtitle_sync | rerun_subtitle |
| duration_long/short | rebuild_timeline → revise_script_target_length |
| file_missing | rerender |

`pick_next_candidate` chỉ liệt kê khi có ứng viên qua cổng; `web_search_scene` chỉ khi nguồn web đã bật. Ngân sách: số lượt, render, USD mỗi dự án, `maxRendersPerDay`, `budget_stop`. Thứ tự được đẩy lên đầu khi một hành động đạt ≥60% trong ≥5 lần (`repairStats`).

## Sai khác / ghi chú
- Một "lượt" = một vòng chẩn đoán (mọi lỗi của một cổng), không phải từng hành động. Cảnh ảnh sửa tức thì nên lặp trong một lần gọi; sửa kịch bản/render khởi động job, lần `approve_gate` sau mới kiểm lại (cột `outcome` có thêm giá trị `pending`).
- Cổng script/render: mỗi vòng một lỗi để các job không đè nhau.
- "Model mạnh hơn" = route `scriptReview` của dự án (tier strong), chưa có route riêng theo hồ sơ.
- `switch_shot_type` đặt cảnh `no_visual` và ghi `repair:"shot_type"` + loại thẻ gợi ý vào `vision_meta`; director compose vẽ thẻ, chưa ép đúng kiểu gợi ý.
- `rephrase_scene_visual` viết lại bằng code (bỏ tên riêng), không gọi LLM.
- Freeze/black ánh xạ sang cảnh bằng `scenes.start_sec`; cần render mới (báo cáo cũ không có giờ) mới ánh xạ được, nếu không chỉ `rebuild_timeline`.
- Chi phí ghi trong `quality_repairs` chỉ gồm lần gọi chọn của agent; chi phí job tự ghi ở usage.
- Dòng "· Tự sửa: N lần, M cảnh đổi ảnh" hiện ở khối "Tự sửa chất lượng" (trường `summary`), chưa nối vào chuỗi tóm tắt stage.
- Undo: ghi vào audit (ảnh cũ, phiên bản script) nhưng `undo.ts` chưa có kiểu hoàn tác mới.
- Breaker riêng cho lỗi sửa (app_settings + finding `breaker_open`), 1 giờ.

## Test
shared 721, web 185, mcp 21, server 1001 (+5 skipped). `npm run typecheck` sạch. Chưa chạy `npm run build` riêng và chưa kiểm tay trên trình duyệt.

## Chưa làm
Kiểm tra thủ công UI trên dự án thử; hoàn tác tự động cho thao tác sửa; open source: không thêm gì.
