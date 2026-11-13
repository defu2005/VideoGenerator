# Không gian làm việc và quyền {#khong-gian-va-quyen}

Mỗi **không gian làm việc** có dự án, hồ sơ kênh, bài đăng, bình luận và tài chính riêng. Người ở không gian này không thấy dữ liệu của không gian khác. Lần đầu chạy bản này, mọi dữ liệu cũ nằm trong không gian **Không gian chính** và chủ sở hữu là người sở hữu nó.

## Sáu vai trò {#vai-tro}

| Vai trò | Làm được |
| --- | --- |
| Chủ sở hữu | Mọi việc, kể cả khoá bí mật và Cursor operator |
| Quản trị | Quản lý kênh, thành viên, cài đặt, tài chính, nhật ký; không dùng operator trừ khi chủ bật |
| Người đăng | Đăng bài, trả lời bình luận, duyệt cổng |
| Người duyệt | Duyệt cổng, chạy bước, sửa dự án |
| Biên tập | Sửa dự án và chạy bước, chưa được duyệt cổng |
| Xem | Chỉ xem (có thể bị ẩn tài chính nếu chủ bật) |

## Quyền theo kênh {#quyen-theo-kenh}

Quản trị và chủ thấy mọi kênh. Với các vai còn lại, bạn có thể cấp quyền cho từng kênh. Quyền thực tế là mức thấp hơn giữa vai trò và quyền kênh. Kênh chưa được cấp thì người đó không thấy (báo "Không tìm thấy").

## Đổi không gian {#doi-khong-gian}

Nếu bạn thuộc nhiều không gian, menu người dùng (cuối menu trái) có ô chọn không gian. Chọn xong trang tải lại.

## Khi bị từ chối {#bi-tu-choi}

Nút bạn không được dùng sẽ ẩn hoặc báo "Bạn không có quyền làm việc này.". Trợ lý và agent cũng chịu cùng giới hạn: trợ lý làm việc với quyền của người đang chat, operator và tác vụ tự động làm với quyền chủ không gian.

## Nhóm và lời mời {#nhom-va-loi-moi}

Chủ và quản trị mở **Nhóm** (menu Cài đặt) để quản lý thành viên.

- **Mời:** bấm "Mời thành viên", nhập email, chọn vai trò và các kênh được xem. Hệ thống tạo một liên kết, hiện **một lần** để bạn sao chép và gửi cho họ. Liên kết có hạn 7 ngày, dùng được một lần và chỉ nhận được bằng đúng email được mời. Bạn có thể huỷ lời mời đang chờ.
- **Vai trò và kênh:** đổi vai trò ngay trong bảng; bấm "Quyền kênh" để chọn kênh và mức quyền. Dòng "Vai trò áp dụng" cho biết mức thực tế.
- **Giới hạn:** không xoá hay hạ vai trò chủ cuối cùng; quản trị không đổi được vai trò chủ hoặc quản trị khác.
- **Bắt buộc 2FA:** chủ có thể bật để chủ và quản trị phải dùng xác thực hai bước; ai chưa bật sẽ bị chuyển tới trang tài khoản.
- **Khóa dịch vụ:** danh sách khóa của chủ và quản trị, chỉ hiện đoạn đầu. Quản trị chỉ thu hồi được khóa của chính mình; chủ sở hữu thu hồi được mọi khóa. Khóa dịch vụ trên máy (MCP, operator, Hermes dùng) chỉ chủ sở hữu mới thu hồi được; thu hồi sẽ làm các dịch vụ đó mất quyền tới khi server khởi động lại (khi khởi động server tự tạo khóa mới). Nút Thu hồi chỉ hiện khi bạn được phép.

Trợ lý và agent không mời, không đổi quyền, không tạo hay thu hồi khóa được; chỉ bạn làm trên giao diện.

## Tài khoản của tôi {#tai-khoan-cua-toi}

Mở từ menu người dùng. Tại đây bạn:

- đổi tên và mật khẩu (các phiên khác bị đăng xuất);
- bật **xác thực hai bước**: nhập mật khẩu, thêm khoá vào ứng dụng xác thực, nhập mã 6 số, rồi lưu **mã dự phòng** (chỉ hiện một lần);
- xem và đăng xuất các phiên đăng nhập;
- tạo **khóa API** cá nhân cho MCP hoặc script. Khóa đầy đủ chỉ hiện đúng một lần khi tạo; mất thì tạo lại.

Quên mật khẩu trên máy chủ: chạy `npm run reset-password -w @vg/server`.

## Nhật ký hoạt động {#nhat-ky-hoat-dong}

Mọi thao tác ghi, kể cả bị từ chối và các lệnh công cụ của trợ lý, được ghi lại 180 ngày; bí mật được che. Chủ và quản trị xem ở trang **Nhật ký hoạt động**: lọc theo người, nguồn (giao diện, trợ lý, MCP, operator, hệ thống), kết quả và ngày; bấm một dòng để xem chi tiết.
