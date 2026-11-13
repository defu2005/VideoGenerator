# TASK-055 report: Computer Use cho Agent operator

## Đã làm
- `apps/server/src/computerUse/`: kiểu adapter, ứng dụng thử giả lập (`ung-dung-thu`) và dịch vụ Computer Use.
  - Cài đặt nằm trong `app_settings` (`computer_use.settings`) và mặc định tắt.
  - Quyền cấp theo ứng dụng/tên miền và theo thao tác, có giới hạn bước và thời gian, có nút dừng (`computer_use.stopped_at`).
- Công cụ registry `computer_use_status`, `computer_observe` (đọc) và `computer_act` (confirm).
  - `computer_act` luôn tạo thẻ chờ người dùng duyệt, kể cả với nguồn agent (`policy.ts`).
- Các điểm dừng:
  - màn hình ra ngoài phạm vi;
  - bước đăng nhập hoặc ô nhạy cảm;
  - dự án được bảo vệ;
  - đích không rõ hoặc trùng nhau;
  - hết bước hoặc thời gian.
- Chữ trên màn hình được coi là dữ liệu.
  - Dòng giống lệnh bị ẩn, và lượt đó bị đánh dấu nên mọi thao tác ghi sau đó đều bị từ chối.
  - Có ý định tương đương API thì trả `use_tool` kèm tên công cụ.
- Mỗi lần dùng ghi một sự kiện `computer_use` với `detail` đã che bí mật. Migration `0048_milky_solo.sql` do drizzle-kit sinh ra thêm cột `operator_events.detail`.
- API: `GET/PUT /api/operator/computer-use` và `POST /api/operator/computer-use/stop`.
- Web: `ComputerUsePanel` trong trang Agent operator và chi tiết Computer Use trong Sự kiện.
- Thêm dòng hướng dẫn trong handbook, hướng dẫn sử dụng, nhật ký thay đổi và featureMap.

## Kiểm chứng
- `apps/server/test/computerUse.test.ts` (5 test):
  - mặc định tắt;
  - hai nguồn thấy cùng một màn hình;
  - ẩn lệnh nhúng;
  - các điểm dừng phạm vi, đăng nhập và dự án bảo vệ;
  - thao tác ghi chờ duyệt với cả bốn nguồn;
  - kết quả không rõ được ghi `needs_check`;
  - giới hạn bước, dừng và bật lại.
- `ComputerUsePanel.test.tsx` cùng các test registry và operator đều pass.

## Giới hạn
- Chưa có adapter cho màn hình máy thật. Chỉ có ứng dụng thử giả lập, nên Computer Use chưa chạm vào desktop thật.
- Chưa thử với Cursor agent hoặc Claude agent thật vì Cursor CLI bị Windows Application Control chặn (ERR_DLOPEN_FAILED). Phần "hai nguồn agent" được kiểm ở mức registry (operator và mcp).
