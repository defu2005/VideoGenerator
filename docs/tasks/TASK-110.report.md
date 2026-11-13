# TASK-110

Đã chuyển đủ năm mẫu sang tokens-v1. Không còn mẫu legacy trong `TEMPLATE_MANIFESTS`.

## Mẫu và trục

`entrance` và `background` là trục chung. Trục riêng:

- `compare`: `layout` split (chỉ 16:9 và 1:1) hoặc stack; `join` badge hoặc divider. Chuỗi kiểu shot vẫn ở `shotStyle`.
- `quote_full`: `layout` center hoặc mark. Cách hiện chữ vẫn trên shot.
- `kinetic_text`: `chrome` plain, bar hoặc rule. bold, typewriter, stack vẫn ở `shotStyle`.
- `chart`: `frame` bleed hoặc card. bar, line, pie vẫn trên shot.
- `map`: `label` plate hoặc float. zoom và highlight vẫn trên shot.

`fallbackStyle` nằm trong `common.js`. `list_full` giữ `fallbackListStyle`, không sửa HTML nên không render lại mẫu cũ.

## Ảnh mẫu

`docs/compose/samples/style/<id>/{newsroom,paper}-{16x9,9x16}.png` cho compare, quote_full, kinetic_text, chart, map. Đã xem từng ảnh.

## Những chỗ chưa đẹp

Không có khung vỡ: chữ Việt còn dấu, không bị cắt, vùng phụ đề 9:16 còn trống.

- So sánh 9:16 cả hai preset xếp chồng, vì split không dùng cho khung dọc. 16:9 khác nhau: newsroom tách đôi và có gạch, paper xếp chồng và có huy hiệu.
- Chữ động: cả hai preset ra thanh dọc. plain và rule vẫn có trong manifest. Khác nhau ở hoa/thường, màu và nền.
- Biểu đồ: cả hai preset ra thẻ. Lần đầu tiêu đề paper bị thẻ che khi chữ vào bằng fade. Đã đưa tiêu đề và biểu đồ lên lớp riêng rồi render lại. bleed vẫn có trong manifest.
- Bản đồ: newsroom là tấm nhãn, paper là chú thích nổi trên vùng đất. Khung 9:16 của paper, dòng phụ sát đầu ghim nhưng vẫn đọc được.
- Chấm dưới chữ hoa Ệ ở preset newsroom là nét của Be Vietnam Pro.

## Test

- `npm run typecheck` ở gốc: đạt.
- `packages/shared`: lần đầy đủ 711 đạt, 2 quá giờ (`test/markets.test.ts`, `test/knowledge.test.ts`). Chạy lại hai file đó: 9 đạt.
- `apps/server`: lần đầy đủ 967 đạt, 3 quá 30 giây (`test/orchestrator.test.ts`, `test/usage.test.ts`, `test/webImageSearch.test.ts`). Chạy lại ba file: 38 đạt. Không có lỗi trong compose hay style. Lần chạy trước đó còn quá giờ khi máy đang render mẫu; các file đó cũng đạt khi chạy lại.
