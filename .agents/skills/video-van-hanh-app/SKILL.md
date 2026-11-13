---
name: video-van-hanh-app
description: >-
  Điểm vào chung để điều khiển app Video Agent đang chạy (không phải để sửa
  code): nối MCP video-agent, giới hạn cứng, bảng việc nào dùng skill nào,
  cách đề xuất skill mới. Đọc skill này trước khi thao tác app bằng bất kỳ
  agent nào (trợ lý trong app, Hermes, Cursor, Codex, Claude).
operator: true
area: ket-noi-agent
triggers:
  - điều khiển app
  - dieu khien app
  - vận hành app
  - van hanh app
  - mcp video-agent
  - agent thao tác app
  - kỹ năng dùng chung
tools:
  - find_skills
  - read_skill
  - get_agent_context
  - propose_skill
risk: safe
---

# Vận hành app Video Agent

## Khi nào dùng

- Bạn là một agent và cần thao tác app đang chạy (dự án, pipeline, đăng bài, model AI...), không phải sửa code.
- Chưa biết việc này thuộc skill nào.

## Kết nối

- MCP `video-agent` chạy qua stdio (`apps/mcp/dist`), gọi API tại `http://127.0.0.1:3001`. Web dev ở cổng 5173 (cổng 5180 cũng được cho phép).
- API phải đang chạy (`npm run dev`). Máy khác hoặc agent chạy trên cloud không gọi được cổng `127.0.0.1` của máy này.
- Khóa nội bộ do MCP client tự đọc từ `data/secrets/local-services.key`. Không dán khóa vào prompt, skill, ghi chú hay báo cáo.
- Tool chưa hiện trong phiên: tải lại MCP, hoặc gọi cùng đường dẫn bằng `app_api` (`method` + `path` bắt đầu bằng `/api/`).
- Bắt đầu mỗi phiên bằng `get_agent_context`, rồi `find_skills` với từ khóa của việc cần làm và `read_skill` để đọc skill tìm được.

## Bảng việc nào dùng skill nào

| Việc | Skill |
|---|---|
| Tạo dự án, chạy pipeline, duyệt gate, retry, sửa chất lượng, SHELVED | `video-du-an-va-pipeline` |
| Tìm ảnh, kiểm tra ảnh bằng vision, `VISUAL_NEEDS_USER`, giọng đọc | `video-hinh-anh-va-giong` |
| Render, timeline, thumbnail, bước render lỗi | `video-render-va-thumbnail` |
| Metadata, đăng bài, hẹn giờ, thứ tự nền tảng | `video-dang-bai` |
| Bình luận | `video-binh-luan` |
| Hồ sơ kênh, guideline, style pack | `video-ho-so-kenh` |
| Model AI, route, vision, chế độ ngân sách, timeout | `video-mo-hinh-ai` |
| Hàng chờ chủ đề, standing order, hàng chờ operator, cron | `video-tu-dong-hoa` |
| Có gì đó lỗi, chưa rõ nguyên nhân | `video-xu-ly-su-co` |
| Vừa làm xong việc lặp lại, muốn lưu cách làm | `video-trich-xuat-ky-nang` |
| Số liệu kênh, doanh thu | `video-doc-so-lieu` |
| Chiến lược kênh, điều kiện kiếm tiền | `video-chien-luoc-kenh` |
| Chọn chủ đề | `video-chon-chu-de` |
| Giữ chân người xem | `video-giu-chan-nguoi-xem` |
| Kiểm tra trước khi đăng | `video-kiem-tra-truoc-khi-dang` |
| Lịch sản xuất | `video-lich-san-xuat` |
| Báo cáo thử nghiệm | `video-bao-cao-thu-nghiem` |

## Giới hạn cứng (mọi agent)

- Không đụng dự án được bảo vệ (id ghi trong `AGENTS.md`): không duyệt gate, không render, không xoá.
- Không đổi mức tự động hoá, quyền, vai trò, ngân sách, khóa audit; không bật fallback trả phí; không đặt hạn mức chi.
- Không gửi hoặc đọc token, khóa OAuth, khóa TTS. Không dùng ảnh có bản quyền.
- Việc rủi ro (`confirm`) chỉ thành "việc chờ duyệt"; chỉ người dùng duyệt.
- Không tải file multipart lên hoặc tải file nhị phân về qua MCP.

## Việc chỉ người dùng làm

Các phần này không có skill thao tác, hãy hướng dẫn người dùng đọc trang hướng dẫn tương ứng:

- Đăng nhập, mật khẩu: `docs/user-guide/dang-nhap.md`
- Kết nối OAuth YouTube/TikTok/Facebook/Instagram: `docs/user-guide/ket-noi.md`
- Không gian và quyền: `docs/user-guide/khong-gian-va-quyen.md`
- An toàn: `docs/user-guide/an-toan.md`
- Cài đặt và ghép Telegram: `docs/user-guide/cai-dat.md`, `docs/user-guide/tro-ly-va-telegram.md`
- Máy worker (thử nghiệm): `docs/user-guide/may-worker.md`

## Đề xuất skill mới

Sau khi làm xong một việc lặp lại, dùng `video-trich-xuat-ky-nang` rồi `propose_skill`. Bản đề xuất luôn là bản nháp; chỉ người dùng kích hoạt trong trang Vận hành > Kỹ năng.

## Kiểm tra kết quả

- `get_agent_context` trả về thông tin phiên; `find_skills` trả về ít nhất một skill cho từ khóa rõ ràng.

## Lỗi hay gặp

- `UNKNOWN_TOOL`: tên tool sai hoặc MCP chưa tải lại.
- `INVALID_TOOL_ARGS`: sai tham số; đọc lại mô tả tool.
- `TOOL_BLOCKED`: việc bị chặn cứng. Không tìm đường vòng, báo cho người dùng.

## Không được làm

- Không dán khóa, token, email vào bất kỳ đâu.
- Không đổi code của app khi chỉ được nhờ vận hành.
- Không đụng dự án được bảo vệ.
