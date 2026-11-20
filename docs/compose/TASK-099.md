# TASK-099 — Sơ đồ và dòng thời gian

## Thiết kế

Mục đích của sơ đồ là làm rõ liên kết giữa các khái niệm; mũi tên có hướng và nhãn, không dùng màu làm dấu phân biệt duy nhất. Luồng ngang chuyển thành luồng dọc ở khung 9:16. Nhiều hơn bốn nút ở khung ngang xuống hàng; vòng và trung tâm dùng bố cục cố định vì tối đa bảy nút.

Dòng thời gian dùng một trục có mốc và nhãn trực tiếp. Mốc thời gian cách đều về mặt ngày tháng được đặt theo tỉ lệ; trường hợp quá sát nhau chuyển sang khoảng cách đều để giữ chữ đọc được. Khung ngang đặt nhãn luân phiên trên/dưới trục, khung dọc đặt nhãn bên phải trục.

Hai template dùng nguyên hợp đồng `tokens-v1` và runtime `common.js`: màu nền/mặt/chữ/nhấn lấy từ `S.color`, thang chữ lấy từ `S.type`, khoảng cách và hình dạng từ `S.space`/`S.layout`, thời lượng và ease từ `M`. Bộ mặc định hiện có là nền xanh đậm, chữ trắng và điểm nhấn vàng; không tạo bảng màu hoặc font riêng. Không sửa template cũ hay token contract.

Các ý tưởng bố cục tham khảo từ Mermaid/dagre và TimelineJS như guide; toàn bộ mã mới do dự án viết, không chép source hoặc thêm dependency.

## Kiểm chứng

- Fixture nội dung: `apps/server/src/compose/eval/structured099.ts`.
- Logic và so sánh chất lượng: `structuredGraphics.test.ts`, `composeDirector.test.ts`, `genreDirector.test.ts` và `genreDirectives.test.ts`. Golden cũ giữ nguyên shots; chỉ thêm `kindShare.diagram` và `kindShare.timeline` bằng 0.
- Render thật ngoại tuyến: `VG_099_SAMPLES=1 npm test -w @vg/server -- --maxWorkers=1 test/structuredGraphicSamples.test.ts`. Mỗi mẫu xuất một frame bằng HyperFrames/Chromium và FFmpeg cục bộ; không gọi provider.
- Có thể chỉ dựng lại sơ đồ bằng `VG_099_SAMPLE_KIND=diagram` cùng cờ trên.
- Bốn ảnh tại `samples/task099/`. Kiểm tra bằng mắt cả bốn; vòng đầu phát hiện nhãn mũi tên ngang bị ô che, đã đặt nhãn phía trên đường nối rồi dựng lại.

## Ảnh mẫu

| Kiểu | 16:9 | 9:16 |
|---|---|---|
| Sơ đồ | [Ngang](samples/task099/diagram-1920x1080.png) | [Dọc](samples/task099/diagram-1080x1920.png) |
| Dòng thời gian | [Ngang](samples/task099/timeline-1920x1080.png) | [Dọc](samples/task099/timeline-1080x1920.png) |

Đây là kiểm tra template và dữ liệu giả, không phải chứng nhận một video chạy provider thật. Không mở, duyệt hoặc render dự án được bảo vệ.
