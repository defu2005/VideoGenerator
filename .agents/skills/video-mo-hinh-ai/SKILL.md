---
name: video-mo-hinh-ai
description: >-
  Điều khiển model AI của app: đổi model và route, gán model nhìn ảnh (vision),
  chế độ ngân sách, quota, timeout từng bước, OmniRoute. Dùng khi người dùng
  muốn đổi model, gặp VISION_PROVIDER_REQUIRED, LLM_QUOTA_WAIT, LLM_BAD_REQUEST
  hoặc bước bị STAGE_TIMEOUT.
operator: true
area: mo-hinh-ai
triggers:
  - đổi model
  - doi model
  - vision
  - quota
  - timeout
  - omniroute
  - route ai
  - vision_provider_required
  - ngân sách
antiTriggers:
  - xoá combo
tools:
  - get_llm_settings
  - get_llm_quota_status
  - get_llm_health
  - update_llm_settings
  - propose_models
  - apply_models
  - compare_models
  - get_model_abilities
  - get_model_scorecard
  - get_model_task_stats
  - get_stage_timeouts
  - update_stage_timeouts
  - clear_llm_cooldown
  - usage_summary
  - get_billing_risk
  - omniroute_health
  - omniroute_list_combos
  - omniroute_list_providers
  - omniroute_test_provider
  - get_routing_proposals
  - propose_route_change
risk: confirm
---

# Model AI, route và ngân sách

## Khi nào dùng

Đổi model hoặc route, gán model nhìn ảnh, kiểm tra quota, chỉnh timeout của bước, xử lý lỗi LLM.

## Kết nối

API chạy tại `http://127.0.0.1:3001`; MCP `video-agent` đọc `apps/mcp/dist`. MCP `omniroute` nối gateway `http://127.0.0.1:20128`. Tool chưa hiện thì tải lại MCP, hoặc dùng `app_api` với đường dẫn `/api/...`.

## Các bước

1. Đọc trạng thái: `get_llm_settings`, `get_llm_quota_status`, `get_llm_health` (nhà cung cấp đang nghỉ, lần chuyển gần đây), `get_model_abilities`; MCP có thêm `get_llm_routes`, `list_vision_models`.
2. Đổi model bằng MCP `set_llm_models`: `task` là một việc, `default`, hoặc `vision` (bốn việc đọc ảnh); `scope` là `app` hoặc `project` kèm `projectId`.
3. Gán Grok nhìn ảnh: `provider` `omniroute`, `model` `grok-cli/grok-4.7`, `task` `vision`. Grok 4 trở lên trên OmniRoute được tính là nhìn ảnh. Không tìm danh sách provider riêng để ghi tên Grok.
4. Gợi ý model theo dữ liệu: `compare_models`, `get_model_scorecard`, `get_model_task_stats`, rồi `propose_models` (safe) và `apply_models` (confirm).
5. Timeout bước: đọc `get_stage_timeouts`; đổi bằng `update_stage_timeouts` (chỉ tạo đề xuất, người dùng duyệt) hoặc MCP `set_stage_timeout` (`recompute: true` để tính lại; `timeoutSec: null` trả về mức ước lượng; đang có bước chạy thì tính lại bị từ chối).
6. Chạy lại bước FAILED bằng MCP `retry_stage` sau khi đọc quota. Nếu lượt còn ít hơn số cảnh và chính sách là chờ reset, không tạo thẻ chạy mới.
7. Cooldown kẹt: `clear_llm_cooldown` (confirm). Chi phí: `usage_summary`, `get_billing_risk`.
8. OmniRoute: `omniroute_health`, `omniroute_list_providers`, `omniroute_list_combos`, `omniroute_test_provider`. Đề xuất đổi route bằng `propose_route_change` hoặc xem `get_routing_proposals`.

## Chế độ ngân sách

Có các chế độ tiết kiệm đến chất lượng cao; chế độ ECO chỉ dùng TTS trả phí khi được ghim. Đổi chế độ là việc của người dùng trong trang Cài đặt; xem `docs/user-guide/che-do-ngan-sach.md`.

## Kiểm tra kết quả

- `get_llm_settings` hiện model mới đúng task và scope.
- Bước FAILED sau khi chạy lại chuyển sang trạng thái mới trong `get_pipeline`.

## Lỗi hay gặp

- `VISION_PROVIDER_REQUIRED`: chưa có model nhìn ảnh; gán như bước 3.
- `LLM_BAD_REQUEST` kèm "OmniRoute nhận tối đa 1 ảnh mỗi lần gọi": trần do app đặt, không phải combo hay skill trên OmniRoute. Không gọi MCP OmniRoute để tìm setting số ảnh. Trần hiện tại là 10 ảnh khi model OmniRoute được bật nhìn ảnh; khởi động lại API rồi chạy lại bước tìm ảnh.
- `LLM_QUOTA_WAIT`: đang chờ reset lượt; không chạy lại ngay.
- `LLM_INVALID_OUTPUT`: model trả sai định dạng; thử một lần nữa rồi đổi model.
- `STAGE_TIMEOUT`: retry được nới 1.5 lần tối đa 30 phút; render, clip, đăng 2 giờ; gia hạn một lần nếu bước còn tiến triển.

## Không được làm

- Không đụng dự án được bảo vệ (id trong `AGENTS.md`).
- Không gửi token Telegram, token OmniRoute hay khóa TTS.
- Không bật fallback trả phí, không đặt hạn mức chi, không đổi mức tự động hoá.
- Không xoá combo hoặc tắt provider OmniRoute khi chưa được người dùng đồng ý.
- Không tải file multipart lên hoặc nhị phân về qua MCP.
