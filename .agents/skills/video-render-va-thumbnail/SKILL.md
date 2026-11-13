---
name: video-render-va-thumbnail
description: >-
  Render video, chỉnh timeline, tạo thumbnail, làm Shorts từ video dài và
  phân loại lỗi khi bước render thất bại. Dùng khi người dùng hỏi video đã
  render chưa, render lỗi, thumbnail xấu hoặc muốn cắt Shorts.
operator: true
area: render-va-thumbnail
triggers:
  - render
  - thumbnail
  - timeline
  - làm shorts
  - lam shorts
  - render lỗi
  - clip
  - máy worker
  - may worker
tools:
  - get_project
  - get_pipeline
  - list_clips
  - compose_plan_preview
  - repair_render_stage
  - undo_timeline_edit
  - make_shorts
  - list_nodes
  - set_node_drain
risk: confirm
---

# Render và thumbnail

## Khi nào dùng

Dự án đã qua gate giọng/hình và cần render; render lỗi; muốn xem hoặc sửa timeline; tạo Shorts.

## Các bước

1. `get_pipeline` xem bước render; `list_clips` xem các clip đã có.
2. Xem trước kế hoạch ghép bằng `compose_plan_preview` trước khi render lại.
3. Render lỗi: `repair_render_stage` (confirm, thành thẻ chờ duyệt). Đọc lỗi cụ thể trước; không sửa mù.
4. Sửa timeline nhầm: `undo_timeline_edit`.
5. Shorts: `make_shorts` từ video dài đã render xong.
6. Máy worker: `list_nodes` xem máy nào online, phiên bản có khớp máy chính không, kết quả dựng thử (`probe`). Máy cần bảo trì hoặc cập nhật: `set_node_drain` với `drain=true` (confirm, thành thẻ chờ duyệt) để máy ngừng nhận việc mới, xong thì `drain=false`. Mã tham gia, thu hồi máy và ghim phiên bản chỉ người dùng làm ở trang Máy.
7. Thumbnail: tạo trong trang Render và thumbnail; chọn bản có chữ ngắn, rõ, không che mặt chủ thể. Tải thumbnail lên là việc của người dùng.

## Kiểm tra kết quả

- Bước render xong, có clip trong `list_clips`, thời lượng khớp giọng đọc.
- Thumbnail đọc được ở kích thước nhỏ.

## Lỗi hay gặp

- `STAGE_TIMEOUT` ở render: giới hạn tối đa 2 giờ; nếu bước vẫn tiến triển app gia hạn một lần. Quá nữa thì xem video có quá dài hoặc máy quá tải.
- Thiếu ảnh hoặc giọng: quay lại `video-hinh-anh-va-giong`.
- Render thất bại lặp lại: đọc `video-xu-ly-su-co`, không bấm thử liên tục.

## Không được làm

- Không tạo mã tham gia, không thu hồi máy worker, không đổi phiên bản mục tiêu; không có tool cho việc đó.
- Không render trên dự án được bảo vệ (id trong `AGENTS.md`).
- Không tải file nhị phân (mp4, ảnh) về qua MCP; dùng đường dẫn xuất trong app.
- Không bỏ qua bước xem trước khi sửa timeline lớn.
