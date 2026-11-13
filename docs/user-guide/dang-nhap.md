# Đăng nhập và tài khoản {#dang-nhap}

App chỉ mở cho người đã đăng nhập, hoặc cho máy này khi có khoá dịch vụ.

## Đăng nhập {#dang-nhap-form}

1. Mở app. Nếu chưa có tài khoản, trang **Thiết lập chủ sở hữu** hiện ra.
2. Nhập tên, email và mật khẩu (ít nhất 8 ký tự), rồi bấm **Tạo chủ sở hữu**. Việc này chỉ làm được một lần.
3. Sau đó vào **Đăng nhập**, nhập đúng email và mật khẩu.
4. Tên của bạn hiện ở cuối menu trái. Mở **Tài khoản** rồi bấm **Đăng xuất** khi xong.

Sai email hoặc sai mật khẩu đều báo cùng một câu. App không cho biết email đó đã có hay chưa.

## Thiết lập từ máy khác {#thiet-lap-lan-dau}

Trên chính máy đang chạy app, bạn không cần mã. Nếu trang thiết lập được mở từ một máy khác, hãy lấy **mã thiết lập một lần** trong log của server (dòng in lúc khởi động, khi chưa có tài khoản), dán vào ô **Mã thiết lập**, rồi tạo chủ sở hữu. Khởi động lại khi vẫn chưa có tài khoản sẽ in một mã mới.

Khoá cho MCP và operator nằm trong thư mục secrets của dữ liệu app, không ghi vào file môi trường và không hiện lại trên màn hình.

## Quên mật khẩu {#quen-mat-khau}

App không gửi email, nên không có link "quên mật khẩu" qua thư. Trên máy đang chạy server, mở terminal ở thư mục dự án và chạy:

```bash
npm run reset-password
```

Nhập mật khẩu mới hai lần (không hiện trên màn hình, ít nhất 8 ký tự). Lệnh đổi mật khẩu của chủ sở hữu và đăng xuất mọi phiên cũ. Muốn đổi cho tài khoản khác, thêm email sau `--`, dạng `npm run reset-password -- <email của tài khoản>`. Không cần tắt server.

Nếu trang đăng nhập báo **server không chấp nhận địa chỉ trang này**, bạn đang mở app ở cổng khác 5173 (ví dụ 5174 khi có một bản Vite cũ còn chạy). Tắt bản cũ rồi mở lại http://localhost:5173. Muốn dùng địa chỉ khác, thêm nó vào `AUTH_TRUSTED_ORIGINS`.
