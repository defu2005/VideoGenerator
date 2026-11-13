# TASK-049 audit

Đã đọc các trang trong `apps/web/src/features/**` và `components/layout/**` trước khi sửa. Thứ tự dưới đây là mức ảnh hưởng với người dùng.

## 1. Điều hướng không theo nhóm, vỡ trên màn hẹp

Sidebar là một danh sách phẳng, lẫn tiếng Anh và tiếng Việt (`Dashboard`, `Projects`, `Thống kê`, `Doanh thu`, `Mức dùng`). Dưới 768 px thanh này trải ngang và cắt bớt mục, không có nút menu. Trang chi tiết hồ sơ chỉ có một link `Hồ sơ` trong eyebrow, không có breadcrumb `Hồ sơ › tên › tab`. Không có cách nhảy nhanh tới trang, hồ sơ hoặc dự án.

Đã sửa: sidebar chia bốn nhóm, thu gọn được, drawer dưới 768 px, breadcrumb trên trang chi tiết, `Ctrl+K` / nút Tìm nhanh.

## 2. Bảng điều khiển không chỉ ra việc cần làm

Dashboard là lưới đếm trạng thái cộng danh sách dự án gần đây. `recentErrors` và xu hướng có dữ liệu nhưng không được nhóm thành “việc cần xử lý”. API `/dashboard/stats` không có cổng chờ duyệt riêng, phê duyệt trợ lý, `needs_token`, OAuth sắp hết hạn, hay bài sắp đăng.

Đã sửa phần bố cục bằng dữ liệu đang có. Phần API còn thiếu ghi ở báo cáo.

## 3. Thiếu trạng thái tải / trống / lỗi thống nhất

`Spinner`, `EmptyState`, `ErrorState` có sẵn nhưng chữ lỗi là tiếng Anh (`Something went wrong`, `Retry`). Bình luận chỉ có một câu “Đang tải…” và “Không tải được hộp thư” không có nút thử lại. Nút gửi bình luận không khoá khi request đang chạy. Xoá bình luận Instagram dùng một hộp nổi riêng, không phải `ConfirmDialog`.

Đã sửa: nút lỗi là “Thử lại”, skeleton đi kèm spinner, bình luận có trạng thái đủ, gửi bị khoá khi đang gửi, xoá dùng `ConfirmDialog`.

## 4. Không có design system

`tailwind.config.js` không có token. Nút, thẻ, badge, bảng và ô nhập được viết lại bằng class trong `index.css` (khoảng một nghìn dòng). Tài chính và mức dùng mỗi nơi một kiểu ô KPI. Không có trang xem component.

Đã thêm token và component trong `components/ui/`, trang dev `/dev/ui` (không có trên sidebar). Các class cũ vẫn trỏ về biến màu cho nút chính, nút nguy hiểm và vòng focus.

## 5. Bundle một cục và refetch khi đổi tab

Trước khi tách route, JS là một file 890,80 kB (gzip 247,50 kB). `staleTime` 15 giây nhưng `refetchOnWindowFocus` vẫn bật. Bình luận, mức dùng, render biến thể và đăng bài vẫn poll khi tab bị ẩn. Pipeline fallback cũng tiếp tục gọi API khi tab ẩn.

Đã tách route bằng `React.lazy`. Shell còn 512,46 kB (gzip 153,78 kB). Tắt refetch khi focus. Poll dừng khi `document.hidden`.

## 6. Danh sách dài không phân trang phía client

Bình luận, chủ đề, bảng video phân tích, nhật ký thông báo và job xuất clip render hết một lần. API list hiện không nhận `limit`/`cursor` (trừ dự án, vốn đã có trang).

Đã thêm “Tải thêm” 20 dòng một lần, không đổi query.

## 7. Thời gian và tiến trình

Mỗi màn tự gọi `toLocaleString`. Không có một helper “3 phút trước” kèm giờ đầy đủ. Render có `%` nhưng không hiện thời gian đã chạy dù `activeJob.startedAt` đã có.

Đã thêm `formatDateTime` (`dd/MM/yyyy HH:mm`), `formatRelative` và `ElapsedTime` trên render đang chạy.

## 8. Việc còn lại, chưa đụng để khỏi đổi hành vi

- CSS cảnh, giọng, nhạc và timeline đã dùng token trong `polish.css`. Khung xem trước phụ đề giữ nền tối và màu chữ của video. Token `--color-music` phân biệt làn nhạc với làn hình.
- Nhiều mutation (lưu cài đặt, duyệt cổng, đăng bài) vẫn báo lỗi tại chỗ, chưa đi qua toast. Hệ thống toast đã có; mới gắn vào tạm dừng tự động hoá và gửi trả lời.
- Nhãn trạng thái dự án (`Draft`, `Review`, …) và một số nút tiếng Anh được giữ vì test và `StatusBadge` đang khoá chúng.
- Trang hồ sơ và cài đặt AI rất dài. Chưa tách layout ngoài breadcrumb và “Tải thêm”.
- Form đã có `field-error` ở dự án và tài chính. Component `Field` mới dùng ở gallery và sẵn cho task sau, chưa thay mọi form cũ.
