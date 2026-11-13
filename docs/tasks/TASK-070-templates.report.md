TASK-070 TEMPLATES REPORT
status: xong phần template (map, compare, quote_full, list_full). Chưa có schema, luật đạo diễn, renderer, metric: đó là phần của Cursor.

## File

Tạo mới:
- `apps/server/assets/compose/map/index.html`
- `apps/server/assets/compose/map/sample.json` (9 hình vẽ tay, thô, chỉ để thử; không phải biên giới thật)
- `apps/server/assets/compose/compare/index.html`
- `apps/server/assets/compose/quote_full/index.html`
- `apps/server/assets/compose/list_full/index.html`
- `docs/compose/templates-070.md` (hợp đồng biến)
- `docs/compose/samples/{map,compare,quote,list}-*.png` (36 ảnh)

Sửa:
- `apps/server/assets/compose/common.js`: thêm helper `VG.times(count, given, opts)` và trả nó ra từ `VGInit()`. Không đổi gì khác. `common.js` nằm trong khoá cache nên cache của chart và kinetic_text sẽ render lại một lần.
- `apps/server/src/compose/eval/runEval.ts`: thêm 9 dòng mẫu vào `SAMPLE_SOURCES`, hàm `sampleGeo()` đọc `map/sample.json`, 2 import.
  **Lệch so với brief ("chỉ thêm dòng"):** có một thay đổi một dòng trong `renderTemplateSamples`: `variables = { ...sample.source, ...graphicVariables(...) }`. Lý do: `graphicVariables` chỉ trả biến chung cho kind lạ, nên không có nó template mới sẽ rỗng. Với chart và kinetic_text kết quả y như cũ vì `graphicVariables` ghi đè cùng các khoá. Khi Cursor thêm nhánh cho 4 kind vào `graphicVariables`, bỏ `...sample.source` và các `as unknown as Shot["source"]`.
- `docs/compose/samples/timings.json`: gộp thêm số đo mới. File này bị ghi đè mỗi lần chạy có `VG_COMPOSE_SAMPLE_ONLY` (hành vi cũ); các dòng `kinetic-*` đã mất từ trước phiên này.

## Kiểm tra

- `npm run typecheck` trong `apps/server`: qua.
- `test/composeGraphic.test.ts`: 25/25 qua (chart và kinetic_text không bị ảnh hưởng bởi `common.js`).
- Chưa chạy toàn bộ `npm test`.
- Mẫu render bằng HyperFrames thật, 1920×1080 và 1080×1920, ảnh giữa và cuối. Tôi đã xem ảnh cuối của mọi mẫu ở ít nhất một tỉ lệ và ảnh giữa của mỗi kind.

## Thời gian render (giây, mỗi cảnh quay, cache lạnh)

| Mẫu | Dài | 16:9 | 9:16 |
| --- | ---: | ---: | ---: |
| map-country (push, fill) | 4 s | 24,6 | 38,6 |
| map-city (fly, glow, from VN) | 4 s | 38,6 | 16,7 |
| compare-versus | 4 s | 16,5 | 20,2 |
| compare-before | 4 s | 20,7 | 34,5 |
| compare-myth | 4 s | 34,4 | 16,5 |
| quote-ghost (10 từ) | 5 s | 17,5 | 27,4 |
| quote-long (27 từ, appear) | 6 s | 28,3 | 49,7 |
| list-bar (3 mục) | 5 s | 45,2 | 19,4 |
| list-six (6 mục, pop) | 6 s | 20,8 | 32,3 |

Số cao (34–50 s) đều rơi vào variant 1 (nền có hạt nhiễu), giống 067b part 2. Không kind mới nào chậm hơn chart.

## Quyết định thiết kế

- **map:** bản đồ phủ toàn khung, nơi được nhắc nằm trong vùng an toàn. Thẻ tên có vùng riêng (trái ở 16:9 khi hình cao, trên ở 9:16 hoặc hình rộng). Bản đầu gắn thẻ cạnh ghim thì thẻ che mất hình nước, nên đã bỏ. Ghim đặt ở điểm sâu nhất trong hình chứ không phải trọng tâm (trọng tâm Việt Nam rơi sang Lào). Nét dùng `vector-effect: non-scaling-stroke` nên zoom không làm nét dày lên. Tên có 1 dòng trừ khi 1 dòng làm chữ nhỏ dưới 62 % cỡ tối đa.
- **compare:** nền hai nửa phủ tràn, chữ trong vùng an toàn; 9:16 chia trên/dưới tại giữa vùng an toàn. Hai nửa cùng cỡ chữ. Nửa "thua" lùi về độ mờ 0,72 sau khi nửa kia vào.
- **quote_full:** dấu nháy vẽ bằng SVG (không phụ thuộc font). Mặc định `ghost`: cả câu hiện mờ sẵn, từ sáng lên theo thời điểm, bố cục không nhảy.
- **list_full:** ưu tiên mỗi mục 1 dòng, chỉ xuống 2 dòng khi 1 dòng làm chữ nhỏ dưới 74 %. 16:9 từ 5 mục chia 2 cột. `settle` trả mọi mục về sáng đều 0,35 s trước khi hết cảnh, để khung cuối (mode `static`) là danh sách hoàn chỉnh chứ không phải "mục cuối đang được nhấn".

## Cursor cần nối

1. `graphicVariables` (`render/graphicVars.ts`): thêm nhánh cho 4 kind, trộn `shot.source` vào biến chung. `quote_full`: tính `words` bằng `kineticWordTimes`. `list_full`: tính `itemTimes` từ thời điểm từ đầu tiên của mỗi mục. `compare`: `rightAt` = thời điểm từ chuyển ý. Chi tiết trong `docs/compose/templates-070.md`.
2. Schema 4 kind theo bảng biến trong hợp đồng, kèm giới hạn độ dài; quá giới hạn thì lùi về `kinetic_text` hoặc ảnh.
3. `map`: thay `sample.json` bằng Natural Earth đã đơn giản hoá. Mỗi feature cần `id`, `name`, `name_<ngôn ngữ>`, `level`. Chỉ truyền feature cắt khung nhìn đầu (≤ 150 KB), và không truyền `level` 1 cho cảnh cấp nước.
4. `render/graphic.ts`: cho 4 kind đi cùng đường với chart (MP4 đặc, `static` dùng khung cuối).
5. Ghi các tham số biến thể (`zoom`, `highlight`, `style`, `reveal`, `marker`…) vào thống kê cảnh quay để vòng học đo được.
6. Sau khi có schema: bỏ `...sample.source` và các cast trong `runEval.ts`.

## Chưa ưng

- `map`: phép chiếu equirectangular đơn giản; chưa xử lý nước vắt qua kinh tuyến 180° và khung nhìn cả thế giới. Chưa thử với dữ liệu thật: hình Natural Earth nhiều đỉnh hơn nhiều, cần đo lại thời gian render và xem nét có bị rối không.
- `map`: tên nước láng giềng đặt ở điểm sâu nhất của hình, bị ẩn khi đụng thẻ hoặc ghim; với nước nhỏ sát nhau có thể chồng lên nhau (chưa có kiểm tra va chạm giữa các tên).
- `map-city`: mẫu thành phố trông trống vì dữ liệu thử quá thô; cần xem lại với admin-1 thật.
- `compare`: nền nửa "thắng" pha màu nhấn vàng trên nền xanh đậm ra tông ô-liu. Đã giảm bằng gradient nhưng với màu nhấn khác nên xem lại.
- `compare-versus` với `winner: none`: hai nửa chỉ khác nhau nhẹ về độ sáng, hơi phẳng.
- `list_full` kiểu `pop`: phần nhấn nhẹ, trên ảnh tĩnh gần như chỉ thấy mục cũ mờ đi. `bar` rõ hơn nhiều; nên để `bar` làm mặc định cho đến khi có số đo.
- Chưa xem video chuyển động thật (chỉ xem khung giữa và cuối), nên nhịp và easing chưa được kiểm bằng mắt.
- Chưa thử với ngôn ngữ không phải Latin (CJK, Ả Rập, Thái): `compare` viết hoa nhãn và `quote_full` tách từ theo khoảng trắng, cả hai đều cần xem lại cho các ngôn ngữ đó.
