TASK-070 POLISH REPORT
status: xong. Chỉ sửa template; không đổi tên biến, schema hay code TS.

## File đã sửa

- `apps/server/assets/compose/compare/index.html`
- `apps/server/assets/compose/list_full/index.html`
- `apps/server/assets/compose/map/index.html`
- `docs/compose/samples/{map,compare,list}-*.png` và `timings.json` (render lại)

`quote_full` và `common.js` không đổi. File test tạm `apps/server/test/_tmp_motion.test.ts` (dùng để xuất dải khung hình) đã xoá.

## Đã đổi gì

**1. Khung 9:16 (compare, list)**
- `compare`: chữ lớn tối đa 14 % chiều rộng (trước 10 %), nhãn lớn hơn 25 %. Hai khối giờ lấp gần hết vùng an toàn.
- `list_full`: hàng cao tới 27 % vùng an toàn (trước 19 %), chữ tối đa 9 % chiều rộng, số thứ tự lớn hơn, danh sách xếp từ dưới tiêu đề xuống thay vì co ở giữa. Danh sách 3 mục giờ kết thúc ở khoảng 66 % chiều cao khung.
- 16:9 giữ nguyên bố cục.
- **Chưa lấp:** 30 % dưới cùng vẫn trống chữ ở cả hai. Đó là vùng phụ đề (`safe.bottom = 0,3`) theo luật 067b part 2, tôi không đặt nội dung vào. Nền nửa dưới của `compare` vẫn phủ tràn xuống đó. Nếu cảnh đồ hoạ không có phụ đề đè lên thì nên giảm `safe.bottom` trong `graphicSafeZone` (code TS, ngoài phạm vi phiên này); template tự giãn theo.

**2. Compare**
- Bên thắng: bỏ lớp phủ màu nhấn (vàng trên xanh đậm ra olive). Giờ là tông sáng của màu thương hiệu (`bgLight`, đã được kiểm tra tương phản với chữ trắng), bên thua tối hơn. Màu nhấn chỉ còn ở nhãn và một gạch dưới chữ bên thắng.
- `winner: none`: huy hiệu VS đập vào (thu từ 2,6 lần), một vòng lan ra, hai nửa giật nhẹ ra xa nhau. Sau đó nửa đầu lùi mờ trong lúc đọc nửa sau, rồi cả hai sáng lại và cùng nhún một nhịp. Nhãn bên phải vẫn giống bên trái (ngang hàng).

**3. List kiểu pop**
- Mục đang đọc phóng 1,12 lần (trước 1,06), đổi sang màu nhấn, số thứ tự nảy lên 1,22 lần. Chỗ cho chữ đã trừ sẵn phần phóng nên không tràn lề.
- Trên dải khung hình, `pop` giờ rõ ngang `bar`. Đề xuất vẫn để `bar` làm mặc định cho đến khi có số đo giữ chân: `bar` đọc tốt hơn khi mục dài 2 dòng, còn `pop` hợp danh sách ngắn. Tôi không đổi mặc định trong code TS.

**4. Map**
- Biển: dải "nước nông" mờ dọc mọi bờ biển, lưới kinh vĩ đậm hơn (10 %), một vùng sáng nhẹ quanh nơi được nhắc, hai vòng nét đứt quanh ghim. Thử với Philippines (không có láng giềng liền kề trong khung): hết trống.
- Mỗi nước có thêm lớp nền đặc màu biển bên dưới, để dải nước nông không hiện dọc biên giới đất liền. Hệ quả: hình trang trí của nền (vòng tròn variant 2) không còn lộ qua đất liền.
- Tên láng giềng: chữ thường, nét thường, cỡ lớn hơn 30 %, độ mờ 0,74 (trước: viết hoa toàn bộ, đậm, 0,6).
- Nơi nhỏ hoặc ít điểm (dưới 10 đỉnh, hoặc nhỏ hơn 16 % cạnh ngắn của khung): hình thô chỉ còn tô nhạt, thêm một vòng tròn vùng màu nhấn quanh ghim. Nước mẹ (`properties.parent`) được tô sáng hơn các nước khác. Mẫu VN-SG giờ đọc được là "một vùng ở miền Nam Việt Nam".
- Sửa lỗi: vòng xung của ghim hiện sẵn một chấm tròn nhỏ từ khung đầu (trước khi zoom xong).

**5. Chuyển động**
- Xuất dải 8 khung hình cho 10 trường hợp (540 p, 30 fps, nháp), cả 16:9 và 9:16: compare none, compare before, list pop, list bar, map nước, map đảo, map thành phố.
- Lỗi tìm thấy và đã sửa: vòng lan của `compare` và vòng xung của ghim hiện từ khung đầu (do `fromTo` vẽ ngay trạng thái đầu).
- 8 khung trên 4–5 giây là thưa: thứ tự và thời điểm đúng, nhưng độ mượt của easing và cú đập VS (0,26 s) chưa được nhìn ở tốc độ thật.

## Ảnh

Thư mục tạm (ngoài repo):
- Trước: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\4c4701e9-1c67-40d4-8f87-ddaa632a32ac\scratchpad\before`
- Sau: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\4c4701e9-1c67-40d4-8f87-ddaa632a32ac\scratchpad\after`
- Dải khung hình: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\4c4701e9-1c67-40d4-8f87-ddaa632a32ac\scratchpad\motion`

Ảnh "sau" cũng là bộ trong `docs/compose/samples/`.

## Kiểm tra

- `test/composeGraphic.test.ts`: 25/25 qua.
- Mẫu chính thức của compare, list, map render lại bằng HyperFrames thật, không cảnh báo. Thời gian mỗi cảnh 17–44 s, cùng khoảng với trước (số cao là variant 1 có hạt nhiễu).
- Không chạy `npm run typecheck` hay toàn bộ `npm test` (không đổi file TS nào).

## Việc còn lại

- Quyết định về vùng phụ đề ở 9:16 cho cảnh đồ hoạ (xem mục 1).
- Xem một video thật ở tốc độ thật để duyệt easing.
- Map: phép chiếu, kinh tuyến 180° và khung nhìn cả thế giới vẫn như báo cáo trước. Tên láng giềng vẫn chỉ bị ẩn khi va chạm, chưa dời chỗ.
- CJK, Ả Rập, Thái: chưa xem. `compare` vẫn viết hoa nhãn.
- `templates-070.md` chưa cập nhật mô tả `pop` và phần trình bày nơi nhỏ của `map` (hợp đồng biến không đổi, chỉ lời mô tả).
