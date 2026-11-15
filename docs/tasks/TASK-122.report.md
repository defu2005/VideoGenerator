# Báo cáo TASK-122: Hermes giám sát Operator

## 1. Bảng dữ liệu và Công cụ giám sát đã thêm
- **5 bảng SQLite mới (migration 0075):** `agent_key_profiles` (loại agent, quyền giám sát), `agent_leases` (khóa tài nguyên 10m TTL), `agent_idempotency` (chống trùng lặp 24h), `agent_instances` (quản lý instance và trạng thái trực), `agent_escalations` (lưu việc chuyển giao).
- **16 công cụ giám sát (supervision tools):** `hermes_duty_heartbeat`, `supervision_snapshot` (<3KB), `operator_runs_list`, `operator_run_get`, `operator_pause`, `operator_resume`, `operator_stop_run`, `operator_new_session`, `operator_enqueue`, `operator_orders_list`, `operator_order_upsert`, `operator_order_disable`, `operator_override`, `escalation_list`, `escalation_claim`, `escalation_resolve`, `escalation_forward_to_user`, `agent_events_poll`, `notify_user`.

## 2. Bản đồ tài nguyên (resourceOf map)
- Mọi công cụ thay đổi dữ liệu (`risk !== "read"`) đều được phân định vào tài nguyên tương ứng:
  - `project`: `update_stage_timeouts`, `run_pipeline`, `approve_gate`, `repair_*`, `publish_project`, `make_*`, `research_scene_visuals`, `crop_scene_images`, `dedupe_scene_visuals`, `delete_project`, `apply_review_proposal`, `undo_timeline_edit`.
  - `profile_automation`: `update_profile_direction`, `set_profile_automation`, `add_topic`, `approve_topics`, `reject_topics`, `delete_topic`, `add_trend_topic`, `run_insight`, `apply_insight`, `suggest_topics`, `set_style_pack`, `propose_style_pack`, `create_project`.
  - `publication`: `cancel_publication`; `account`: `add_revenue_entry`; `operator_run`: `operator_stop_run`.
  - `global`: các công cụ toàn cục/cài đặt chung/giám sát (`decide_overdue`, `pause_automation_all`, `operator_pause`, `escalation_*`, `notify_user`...).
- Kiểm thử bao phủ tự động xác nhận 100% công cụ ghi đều có cấu hình `RESOURCE_MAP`.

## 3. Bảng điều hướng chuyển giao việc (Escalation Routing)
- **Thứ tự ưu tiên:** Người dùng (rank 40) > Hermes trực (rank 30) > Hermes khác (rank 20) > Operator (rank 10).
- **Chuyển giao cho Hermes (khi đang trực, hạn chót 30 phút):** `held_quality_gate`, `repair_exhausted`, `stuck_job`, `provider_failing`, `publish_failure`, `unclear_instruction`.
- **Luôn chuyển thẳng người dùng:** Hành động cần xác nhận (`confirm`), bí mật/token/key, tiền bạc, quyền hạn, xoá vĩnh viễn (`delete`), dự án bảo vệ (`56374fb2-54cf-48ff-9441-2e6c653295d4`), việc người dùng yêu cầu tự xem, hoặc khi đã chuyển qua lại 3 lần (`hops >= 3`).
- **Tự động chuyển tiếp:** Quá hạn 30 phút hoặc Hermes mất trực thì tự chuyển người dùng.

## 4. Liên kết danh tính với Machine Key (Identity Binding)
- Danh tính agent được xác thực từ bản ghi `agent_key_profiles` ứng với key từ TASK-114 (`agentKind`, `instanceName`, `canSupervise`).
- Header tự khai báo giả mạo bị bỏ qua; Policy Rule 4 chặn cứng mọi agent sửa `agentKind` hay `canSupervise`.
- Operator nội bộ dùng danh tính cố định `operator/app` (không thể giám sát).

## 5. Giao diện Web & Kỹ năng (Skills)
- Web Operator bổ sung Tab "Hermes" hiển thị: trực nhật, standby instances, việc chuyển giao, khóa leases, nhật ký audit, trạng thái tạm dừng.
- Trang tài khoản/khóa bổ sung chọn `agentKind` và bật/tắt `canSupervise`.
- Thêm kỹ năng `.agents/skills/vg-supervise/SKILL.md` và `vg-escalation/SKILL.md`. Lệnh cron: `hermes cron create "every 15m" "Run the vg-supervise skill" --skill vg-supervise --name vg-supervise`.

## 6. Kết quả kiểm thử
- `npm run typecheck`: Không còn lỗi trên toàn bộ 4 workspace (`@vg/shared`, `@vg/mcp`, `@vg/server`, `@vg/web`).
- `apps/server/test/supervision.test.ts`: 23/23 passed (danh tính, preemption, idempotency, duty, escalation, fail-safe, snapshot).
- Web tests: `HermesTab.test.tsx` (1/1 passed), `OperatorPage.test.tsx` (4/4 passed), `guideCoverage.test.ts` (5/5 passed).
- Không có phần việc nào bị bỏ sót.
