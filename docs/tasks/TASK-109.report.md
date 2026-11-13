# TASK-109 — Lưu style pack và diện mạo video

## Migration

`apps/server/drizzle/0064_style_packs.sql` (do `drizzle-kit generate` tạo). Lần generate thứ hai in `No schema changes, nothing to migrate`.

Cần khởi động lại app để migration chạy.

## Lưu gì, khi nào

- `style_packs`: một dòng mỗi phiên bản (`id`, `version`, `name`, `origin`, `seed`, `tokens`, `created_at`), khóa `(id, version)`, chỉ chèn. `savePack` đi qua `reviseStylePack` và không chèn khi fingerprint không đổi.
- `profiles.style_pack_id`: id của pack, không phải phiên bản. Lần render compose đầu tiên của hồ sơ chưa có pack thì tạo và gắn: màu khác ô mặc định `#3B82F6` dùng `stylePackFromBrand`; không thì preset trong `STYLE_PRESETS` mà hồ sơ khác chưa dùng.
- `video_looks`: sau render xong, ngay sau kiểm tra nguyên bản. `look` là JSON `VideoLookSchema`. Bản render dùng lại cache không ghi thêm dòng. Ghi lỗi thì chỉ cảnh báo, render vẫn xong.
- `renders.report.compose.style`: `packId`, `packVersion`, `fingerprint` của pack đã dùng.

## Hash khung

dHash (`phash`) của các JPEG trong thư mục `thumbs` của bản render, qua `hashImage` và `dHashFromGray` (`packages/shared/src/visuals/phash.ts`). File không phải JPEG thì bỏ qua. Hash lỗi thì vẫn ghi look với `frameHashes` rỗng.

## API

`GET /api/style/presets`, `GET /api/profiles/:id/style-pack` (pack và token đã resolve), `GET /api/profiles/:id/looks?limit=`. Route hồ sơ không nằm trong tool registry dùng chung, nên ba route này không được đăng ký thành tool.

## Lệch

Màu mặc định `#3B82F6` không tính là màu thương hiệu, để hai hồ sơ mới không cùng một preset. Không sửa `packages/shared/src/style/`. `RenderReportSchema` thêm `compose.style` để báo cáo strict giữ được pack. Không thêm thư viện.

## Kiểm thử

- `npm run typecheck` ở gốc: đạt.
- `packages/shared`: 87 file, 709 test đạt.
- `apps/server`: suite đầy đủ 967 đạt, 5 bỏ qua; timeout ngoài phạm vi ở `test/tiktokPublisher.test.ts` (một test) và hook `afterAll` của `test/projects.test.ts`. Chạy lại hai file đó: 37 đạt. Tính cả lần chạy lại: 968 đạt, 5 bỏ qua. Thêm 7 test trong `test/styleStore.test.ts` (phiên bản pack, hai preset khác nhau, lịch sử đổi tổ hợp, lỗi ghi không hỏng render, cache không ghi lần hai, ba GET).
