---
name: video-xem-truoc-nhanh
description: >-
  Khi nào xem trước một cảnh hoặc cả video trước khi render: lấy một khung,
  contact sheet hoặc đoạn 3 giây để kiểm tra chữ sát mép, khung tối/sáng, cảnh
  trùng nhau mà không tốn một lần render đầy đủ. Dùng sau khi đổi kiểu cảnh,
  hình, đồ họa hoặc phong cách, và trước khi duyệt cổng render.
operator: true
area: du-an-va-quy-trinh
triggers:
  - xem trước
  - xem truoc
  - contact sheet
  - preview
  - kiểm tra khung hình
tools:
  - preview_frame
  - preview_contact_sheet
  - preview_clip
  - get_pipeline
risk: read
---

# Xem trước nhanh trước khi render

## Khi nào dùng

Vừa sửa cảnh, hình, đồ họa hoặc phong cách và muốn biết kết quả có ổn không. Bản thử nghiệm 10 cảnh đo được khoảng 1,6 giây cho khung, 5 giây cho sheet và 5 giây cho clip. Bộ dựng dự phòng có thể chậm hơn.

## Thứ tự làm

1. `preview_contact_sheet` với `sceneId: "all"` để nhìn cả video một lượt. Đọc `facts` và `warnings`: chữ sát mép, khung tối/sáng, cảnh gần giống nhau, chữ quá dày so với thời lượng.
2. Cảnh đáng ngờ: `preview_frame` với `sceneId` và `offsetSec` để xem đúng một khung.
3. Cần xem chuyển động hoặc khớp giọng: `preview_clip` (tối đa 3 giây).
4. Sửa rồi xem lại; kết quả được lưu đệm nên cảnh không đổi sẽ trả về ngay.

## Kiểm tra kết quả

- `basis` là `timeline` thì khớp bản render. Là `selection` thì chỉ là ước lượng (Timeline chưa xong): đừng kết luận về nhịp hay phụ đề.
- Không có `warnings` nghiêm trọng trước khi xin duyệt cổng render.

## Không được làm

- Không dùng thay cho render khi cần chất lượng cuối; đây là bản độ phân giải thấp.
- Không gọi liên tục trên cả video; máy chỉ chạy 2 bản xem trước cùng lúc, gặp `PREVIEW_BUSY` thì chờ vài giây.
- Dự án được bảo vệ (id trong `AGENTS.md`): không xem trước.
