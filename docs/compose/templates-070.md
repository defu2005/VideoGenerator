# Hợp đồng biến cho 4 template TASK-070

Bốn template mới: `map`, `compare`, `quote_full`, `list_full`. Mỗi template nằm ở `apps/server/assets/compose/<kind>/index.html` và dùng `common.js` (`window.VGInit()`).

Tài liệu này nói template nhận biến gì. Schema, luật đạo diễn, `graphicVariables`, metric và test là việc của Cursor.

## Biến chung (đã có từ 067b part 2)

`graphicVariables` đã trả các biến này cho mọi kind, template mới dùng y nguyên:

| Biến | Kiểu | Ghi chú |
| --- | --- | --- |
| `durationSec` | số | thời lượng cảnh quay |
| `variant` | 0, 1, 2 | 3 kiểu nền của `common.js` |
| `colors` | `{ bg, bgLight, bgDark, text, accent, muted, series }` | đã kiểm tra tương phản trong TS |
| `safe` | `{ top, right, bottom, left }` | phần khung để trống (phụ đề, nút bên phải ở 9:16) |
| `language` | chuỗi | `map` dùng để chọn `name_<language>` |
| `grain` | boolean, tuỳ chọn | hạt nhiễu của variant 1 |

**Việc cần nối:** với kind không phải `chart` hay `kinetic_text`, `graphicVariables` hiện chỉ trả biến chung. Cần thêm nhánh cho 4 kind mới để trộn `shot.source` vào (như nhánh `chart`), và tính thời điểm từ ở chỗ ghi bên dưới.

Mọi thời điểm là **giây tính từ đầu cảnh quay**. Mọi chuyển động xong trước `durationSec − 0,2`, nên khung cuối luôn hoàn chỉnh (dùng được cho mode `static`).

Helper mới trong `common.js`: `VG.times(count, given, { from, spread, enter })`. Nó nhận mảng số hoặc mảng `{ t }`; nếu không khớp số phần tử thì rải đều. `chart` và `kinetic_text` không dùng nó, hành vi của chúng không đổi.

---

## `map`

Bản đồ phủ toàn khung, zoom từ vùng rộng vào nơi được nhắc, ghim rơi xuống, thẻ tên hiện ra. Thẻ tên có vùng riêng nên không che nơi được nhắc: bên trái ở 16:9 khi hình cao, phía trên ở 9:16 hoặc khi hình rộng.

| Biến | Kiểu | Bắt buộc | Ví dụ | Ghi chú |
| --- | --- | --- | --- | --- |
| `geo` | GeoJSON `FeatureCollection` | có | xem `map/sample.json` | chỉ `Polygon` và `MultiPolygon`. Truyền thẳng qua biến, template không fetch |
| `focus` | chuỗi | nên có | `"VN"`, `"VN-SG"` | `properties.id` của nơi được nhắc |
| `pin` | `[lon, lat]` | không | `[106.7, 10.8]` | vị trí ghim. Không có thì lấy điểm nằm sâu nhất trong hình `focus` |
| `label` | chuỗi | không | `"Việt Nam"` | mặc định `name_<language>` rồi `name` của `focus` |
| `sublabel` | chuỗi | không | `"Đông Nam Á"` | một dòng nhỏ dưới tên |
| `from` | chuỗi hoặc `[tây, nam, đông, bắc]` | không | `"VN"` | khung nhìn lúc bắt đầu: id một feature hoặc một hộp toạ độ |
| `zoomFrom` | số | không | `3.2` | khi không có `from`: khung đầu rộng gấp mấy lần khung cuối |
| `minSpanDeg` | số | không | `2.5` | khung cuối không hẹp hơn chừng này độ, để thành phố vẫn thấy xung quanh |
| `spanDeg` | số | không | `3` | nửa cạnh khung cuối khi chỉ có `pin`, không có `focus` |
| `zoom` | `"push"`, `"fly"`, `"static"` | không | `"push"` | xem biến thể |
| `highlight` | `"fill"`, `"outline"`, `"glow"` | không | `"fill"` | xem biến thể |
| `neighbours` | boolean | không | `true` | tên các nước xung quanh, mờ |

**Feature cần có `properties`:** `id` (chuỗi, duy nhất), `name` (tiếng Anh), `name_<mã ngôn ngữ>` (ví dụ `name_vi`), `level` (0 = nước, 1 = tỉnh/bang; thiếu thì coi là 0). `parent` chưa được template dùng.

**Giới hạn:**
- `label` ≤ 24 ký tự (một dòng; dài hơn xuống 2 dòng, tối đa ~40). `sublabel` ≤ 30 ký tự, một dòng.
- `geo` gửi vào nên ≤ 150 KB: chỉ gửi feature cắt khung nhìn đầu, không gửi cả file thế giới. Dữ liệu nằm trong `variables.json` và trong khoá cache.
- Với cảnh cấp nước, đừng gửi feature `level` 1 (chúng hiện thành nét mờ, gây rối). Với cảnh cấp tỉnh, gửi nước mẹ (`from`) và tỉnh được nhắc.
- Phép chiếu là equirectangular co theo vĩ độ của nơi được nhắc: ổn cho một nước hay một vùng, méo với khung nhìn cả thế giới hoặc vĩ độ trên 65°. Nước vắt qua kinh tuyến 180° (Nga, Fiji) chưa xử lý.

**Thời lượng:** tối thiểu 2,5 s, hợp lý 3–5 s, tối đa 7 s. Zoom dài `min(1,4; 45 % cảnh)`, ghim rơi ngay khi zoom xong, thẻ tên sau đó 0,25 s.

**Biến thể agent nên chọn và đo:**
- `zoom`: `push` (zoom thẳng), `fly` (vừa lia ngang vừa zoom, từ xa hơn), `static` (không zoom, chỉ đẩy nhẹ 12 % suốt cảnh; hợp cảnh dưới 3 s hoặc khi cùng một nơi lặp lại).
- `highlight`: `fill`, `outline`, `glow`.
- `neighbours`: bật hay tắt.
- `zoomFrom` hoặc `from`: bắt đầu từ vùng, từ nước mẹ, hay từ châu lục.
- Có hay không có `sublabel` (một dữ kiện ngắn như dân số).

---

## `compare`

Chia đôi: trái | phải ở 16:9, trên / dưới ở 9:16. Nửa đầu mở cảnh, nửa sau vào đúng lúc lời đọc chuyển ý.

| Biến | Kiểu | Bắt buộc | Ví dụ | Ghi chú |
| --- | --- | --- | --- | --- |
| `left` | `{ label, text }` | có | `{ "label": "Thuê nhà", "text": "8 triệu mỗi tháng" }` | nửa nói trước (ở 9:16 là nửa trên) |
| `right` | `{ label, text }` | có | `{ "label": "Mua nhà", "text": "15 triệu mỗi tháng" }` | nửa nói sau |
| `style` | `"versus"`, `"before_after"`, `"myth_fact"` | không | `"versus"` | xem biến thể |
| `rightAt` | số (giây) | không | `1.6` | lúc nửa sau xuất hiện. Nên là thời điểm của từ chuyển ý ("so với", "sau", "sự thật"). Mặc định 42 % cảnh |
| `reveal` | `"sequence"`, `"together"` | không | `"sequence"` | `together`: hai nửa cùng vào, cho cảnh ngắn |
| `winner` | `"left"`, `"right"`, `"none"` | không | | nửa được nhấn (nền sáng, nhãn màu nhấn; nửa kia lùi lại). Mặc định `none` với `versus`, `right` với hai kiểu còn lại |
| `badge` | chuỗi ≤ 3 ký tự | không | `"VS"` | chỉ cho `versus` |

**Giới hạn:**
- `label` ≤ 16 ký tự, một dòng, tự viết hoa.
- `text` ≤ 40 ký tự (tốt nhất ≤ 28). 16:9 tối đa 4 dòng, 9:16 tối đa 3 dòng. Hai nửa luôn cùng cỡ chữ, nên một bên dài sẽ kéo nhỏ cả hai: giữ hai bên dài gần bằng nhau.
- `label` trống thì nửa đó chỉ có chữ lớn.

**Thời lượng:** tối thiểu 2,5 s (`together` 2 s), hợp lý 3–5 s, tối đa 6 s.

**Biến thể agent nên chọn và đo:**
- `style`: `versus` (huy hiệu VS, hai bên ngang hàng), `before_after` (mũi tên, nửa sau được nhấn), `myth_fact` (dấu ✕ và ✓ trên nhãn).
- `reveal`: `sequence` hay `together`.
- `winner`: nhấn một bên hay để ngang hàng.
- `rightAt`: theo từ chuyển ý hay theo tỉ lệ cố định.

---

## `quote_full`

Hai dấu nháy lớn màu nhấn, câu trích đậm, tên người nói bên dưới. Variant 1 canh trái, variant 0 và 2 canh giữa.

| Biến | Kiểu | Bắt buộc | Ví dụ | Ghi chú |
| --- | --- | --- | --- | --- |
| `quote` | chuỗi | có | `"Đầu tư vào tri thức luôn mang lại lợi nhuận cao nhất"` | dấu nháy ở hai đầu tự bỏ (template tự vẽ dấu) |
| `speaker` | chuỗi | nên có | `"Benjamin Franklin"` | |
| `role` | chuỗi | không | `"Nhà khoa học"` | |
| `words` | `[{ text, t }]` | không | `[{ "text": "Đầu", "t": 0.2 }, …]` | thời điểm từng từ; số phần tử phải bằng số từ của `quote` (tách theo khoảng trắng) |
| `wordTimes` | `number[]` | không | `[0.2, 0.5, …]` | dạng gọn của `words`; dùng một trong hai |
| `emphasis` | `number[]` | không | `[3, 4]` | chỉ số từ được tô màu nhấn |
| `reveal` | `"ghost"`, `"appear"`, `"block"` | không | `"ghost"` | xem biến thể |
| `speakerAt` | số (giây) | không | | lúc tên người nói hiện. Mặc định sau từ cuối 0,3 s |

**Nối với thời điểm từ:** dùng lại `kineticWordTimes(count, durationSec, wordTimes)` trong `graphicVars.ts` rồi truyền `words` như `kinetic_text`. Không có thì template rải đều các từ trên 62 % cảnh.

**Giới hạn:**
- `quote`: 6–28 từ, ≤ 160 ký tự. 16:9 tối đa 4 dòng, 9:16 tối đa 7 dòng. Trên 28 từ chữ bắt đầu nhỏ trên điện thoại: đạo diễn nên cắt câu hoặc lùi về `kinetic_text`.
- `speaker` ≤ 32 ký tự, `role` ≤ 32 ký tự.
- `emphasis` ≤ 3 từ.

**Thời lượng:** tối thiểu 3 s, hợp lý khoảng `0,3 s × số từ + 1 s`, tối đa 10 s.

**Biến thể agent nên chọn và đo:**
- `reveal`: `ghost` (cả câu hiện mờ sẵn, từ sáng lên khi được đọc: bố cục đứng yên, dễ đọc trước), `appear` (từ hiện dần từ trống), `block` (cả câu vào một lần, cho cảnh ngắn hoặc không có thời điểm từ).
- Có hay không có `emphasis`.
- Có hay không có `role`.

---

## `list_full`

Tiêu đề (tuỳ chọn) và 3–6 mục có số thứ tự. Mỗi mục vào đúng thời điểm của nó và được nhấn cho đến mục kế. Ở 16:9, từ 5 mục trở lên chia 2 cột (đọc hết cột trái rồi sang cột phải).

| Biến | Kiểu | Bắt buộc | Ví dụ | Ghi chú |
| --- | --- | --- | --- | --- |
| `items` | `string[]` | có | `["Uống một cốc nước ấm", "Vận động 10 phút", "Không xem điện thoại"]` | 3–6 mục; mục thứ 7 trở đi bị bỏ |
| `title` | chuỗi | không | `"3 thói quen buổi sáng"` | |
| `itemTimes` | `number[]` | không | `[0.4, 1.8, 3.1]` | lúc bắt đầu đọc từng mục; số phần tử bằng số mục |
| `highlight` | `"bar"`, `"pop"`, `"none"` | không | `"bar"` | xem biến thể |
| `marker` | `"number"`, `"dot"` | không | `"number"` | |
| `settle` | boolean | không | `true` | 0,35 s trước khi hết cảnh, mọi mục sáng đều lại để khung cuối là danh sách hoàn chỉnh |

**Nối với thời điểm từ:** `itemTimes[i]` là thời điểm từ đầu tiên của mục `i` trong lời đọc, trừ đi thời điểm bắt đầu cảnh quay. Không có thì template rải đều trên 70 % cảnh.

**Giới hạn:**
- Mỗi mục ≤ 36 ký tự (tốt nhất ≤ 24 để nằm một dòng), tối đa 2 dòng. Mọi mục cùng cỡ chữ.
- `title` ≤ 40 ký tự, tối đa 2 dòng.
- Dưới 3 mục thì dùng `kinetic_text` kiểu `stack`.

**Thời lượng:** tối thiểu `0,8 s × số mục + 0,8 s`, hợp lý 1,2–2 s mỗi mục, tối đa 12 s. Hai mục cách nhau dưới 0,45 s thì mục trước không kịp nhận phần nhấn.

**Biến thể agent nên chọn và đo:**
- `highlight`: `bar` (thanh nền màu nhấn sau mục đang đọc, mục cũ mờ đi), `pop` (mục đang đọc phóng nhẹ, mục cũ mờ đi), `none` (chỉ hiện dần).
- `marker`: số hay chấm.
- `settle`: bật hay tắt.
- Có hay không có `title`.
- Số mục mỗi cảnh (3–4 so với 5–6): cảnh 6 mục chữ nhỏ hơn rõ trên 9:16; có thể tách thành hai cảnh.

---

## Gợi ý đưa vào registry

Mỗi dòng "biến thể" ở trên là một tham số rời, giá trị hữu hạn, không cần đổi template để thử. Đề xuất ghi `kind` + các tham số này vào thống kê của cảnh quay để vòng học so sánh được (ví dụ `map.zoom=fly` so với `push` theo tỉ lệ giữ chân ở đoạn đó). `variant` (nền) đang là hash; nếu muốn đo nền thì cho phép kế hoạch ghi đè nó.
