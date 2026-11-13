# TASK-108 — Nối style vào mẫu đồ hoạ

## Đã nối

Mỗi video resolve style một lần trong `prepareGraphicStyle` (`apps/server/src/compose/render/graphicStyle.ts`), gọi từ `renderService` sau khi có compose plan. Thể loại lấy `genrePack(recipeId).style`. Pack lấy `stylePackFromBrand` khi có màu thương hiệu, không thì null. Lớp video và shot là null. `pickVariants` dùng seed `profileId|projectId`, lịch sử rỗng. Trục đã ghim trên shot (`highlight`, `marker` của `list_full`) được giữ. Mọi mẫu nhận `variables.style = templateStyle(...)`. `brandColor`, `accentColor` và `colors` vẫn do `graphicColors` cấp.

Lệch so với hướng dẫn: schema pack cấm dấu `:`, nên id là `project-` cộng project id, không phải `project:`. `kinetic_text` và `compare` vẫn đọc chuỗi style cũ qua `shotStyle`. `common.js` chép bảng màu từ `style.color` khi object có mặt, để mẫu chưa chuyển vẫn tô đúng nền. Không sửa `packages/shared/src/style/`.

Khi thiếu style, render thật luôn gửi style từ server (`styleForShot`, cuối cùng `templateStyle(resolveStyle({}, frame))`). `list_full` bỏ `throw` và có `fallbackListStyle()` cho lần mở HTML trực tiếp. Bản dựng thật đi đường server.

Tài liệu: `docs/architecture/style-system.md`. Nhật ký người dùng có mục `## TASK-108`.

## Cache

Khoá cảnh (`sceneCacheMaterial`) và hash clip trong `renderService` thêm `styleFingerprint` và `styleAxes`. Cache file HyperFrames băm cả `variables`. Đổi style hoặc trục thì dựng lại; style không đổi thì dùng lại.

## Ảnh mẫu

`docs/compose/samples/style/`: `newsroom-16x9.png`, `newsroom-9x16.png`, `paper-16x9.png`, `paper-9x16.png`. Hai preset `newsroom` và `paper`, 1920×1080 và 1080×1920, qua đường `VG_COMPOSE_SAMPLES=1`.

Nhìn bốn ảnh: dấu tiếng Việt đủ (Uống, nước, ấm, điện thoại, đủ chất), không chữ bị cắt, chữ 9:16 nằm trên vùng phụ đề. Khoảng trống phía dưới là safe zone. Vòng tròn nền của paper bị mép khung cắt, đúng kiểu nền shapes. Không sửa mẫu khác.

## Kiểm thử

- `npm run typecheck` ở gốc: đạt.
- `npm test` trong `packages/shared`: 87 file, 709 test đạt.
- `npm test` trong `apps/server`: 112 file đạt, 1 file bỏ qua; 961 test đạt, 5 bỏ qua. Test TASK-107 đã có sẵn trong `timeline.test.ts` và `render.test.ts` (recheck ném lỗi, bước vẫn xong, có cảnh báo) và nằm trong suite này.
- `composeGraphic.test.ts`: 28 đạt (style có mặt, đổi theo pack, cùng seed cùng trục, cache đổi theo style, `list_full` không còn throw).
- Ảnh mẫu: lượt đủ bốn ảnh dừng sau `paper-16x9` (khoảng 07:45 ICT, 12/11/2026). `paper-9x16` dựng lại bằng cùng hàm; test lọc `style preset` đạt lúc 07:48 ICT (1 đạt, 3 bỏ qua).

Không commit, không migration, không đụng pipeline, jobs, originality, publishing.
