# TASK-116 báo cáo: giao diện Nhóm, Tài khoản, Nhật ký

## Đã làm
- Server (`apps/server/src/auth/`): `teamRoutes.ts` (thành viên, vai trò, quyền kênh, lời mời, cài đặt, khóa dịch vụ), `acceptInvite.ts` (xem lời mời, đăng ký bằng lời mời, tham gia khi đã đăng nhập), `accountGuard.ts` (chặn endpoint organization của plugin, ghi nhật ký thao tác tài khoản và khóa), `permissionHook.ts` (403 `TWO_FACTOR_REQUIRED` cho chủ/quản trị chưa bật 2FA khi nhóm bắt buộc), `meRoutes.ts` (`/api/me` có `twoFactorEnabled`, `twoFactorRequired`; `/api/audit` có lọc và phân trang).
- Web: trang Nhóm (`/team`), Tài khoản của tôi (`/account`), Nhật ký hoạt động (`/audit`), Lời mời (`/invite/:id`), bước 2FA ở đăng nhập, mục menu, tự chuyển tới `/account` khi bị bắt buộc 2FA.
- Tài liệu: mở rộng `khong-gian-va-quyen.md`, thêm dòng vào `nhat-ky-thay-doi.md`, thêm 3 mục featureMap.
- Không migration. `reset-password` vẫn chạy. `routePermissions.ts` không đổi.

## Khác với guide
- Tắt 2FA chỉ cần mật khẩu (plugin không đòi mã).
- Hạn lời mời 7 ngày (plugin mặc định 48 giờ).
- Tham gia khi đã đăng nhập dùng route riêng `/api/setup/invite/:id/join`, không dùng plugin.
- Quản trị thu hồi được khóa của mọi chủ/quản trị trong danh sách khóa dịch vụ.
- Giới hạn nhận lời mời: 30 lần / 10 phút / IP.
- Chưa có mã QR (không thêm dependency): hiện khóa dạng chữ và liên kết otpauth. Gợi ý sau này: thư viện QR MIT không phụ thuộc.

## Lưu quyền kênh của lời mời
Không có cột metadata và không được migration, nên lưu trong bảng `verification` với identifier `invite-grants:<invitationId>`; khi nhận lời mời thì chuyển thành quyền thật trong một transaction.

## An toàn
- `registry/policy.ts` (TASK-115) đã cấm agent mời, đổi vai trò/quyền, xoá thành viên, tạo/thu hồi khóa, đổi 2FA; không sửa policy, guard, hard block, giới hạn TASK-059.
- Khóa API đầy đủ, mã dự phòng chỉ hiện một lần; khóa dịch vụ chỉ hiện đoạn đầu; nhật ký che bí mật. Lời mời đã dùng/hết hạn/huỷ/không có đều trả cùng một thông báo.
- Mọi thay đổi có toast; thao tác phá huỷ có hộp xác nhận. Web chỉ ẩn, server quyết định.

## Kiểm thử
- `npm run typecheck`: sạch.
- shared 721 test đạt; web 193 đạt (có `team116.test.tsx`, 7 test); server 1037 đạt, gồm `team.test.ts` (9) và `acceptInvite.test.ts` (6).
- `test/auth.test.ts` thất bại một lần khi chạy cả bộ (tải nặng), chạy riêng 8/8 đạt.
