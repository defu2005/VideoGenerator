# TASK-070

Phần nối dây của bốn kind đồ hoạ. Hợp đồng trong `docs/compose/templates-070.md` được dùng khi lệch với `docs/cursor/TASK-070.md`. CSS, bố cục, màu và chuyển động của template HTML giữ nguyên. `COMPOSE_RENDER_VERSION` là 2.

## Đã làm

1. Schema zod cho `map`, `compare`, `quote_full`, `list_full` nằm ở `packages/shared/src/compose/graphicKind.ts`. Giới hạn độ dài lấy từ hợp đồng. Dữ liệu LLM hỏng thì `fitGraphicPayload` trả `null` và span đó rơi về ảnh tĩnh (map) hoặc chữ động (ba kind còn lại, list dùng kiểu stack). Cảnh không bị loại. Lý do gắn `+bad-graphic`.
2. `compose/eval/runEval.ts` không còn trải `...sample.source` và không còn ép `as unknown as Shot["source"]`. Mẫu đọc `sample.json` qua `MapGeoSchema`. Dòng dựng shot vẫn có `as Shot` vì TypeScript không giữ cặp `kind` với `source` khi cả hai lấy từ một union.
3. `render/graphic.ts` và `sceneClip.ts` đưa cả sáu kind đồ hoạ qua cùng đường chart: MP4 đặc, chế độ tĩnh lấy khung đã xong.
4. `graphicVariables` chuẩn bị geo, ghim, câu chữ và thời điểm. So sánh lấy `rightAt` từ từ tương phản, không có thì 42% thời lượng. Trích dẫn dùng `kineticWordTimes`. Danh sách lấy thời điểm từ đầu mỗi mục.
5. Bản đồ: Natural Earth v5.1.2, phạm vi công cộng. `world.json` là admin-0 110m, 177 nước, 148.010 byte. `vn.json` là admin-1, 60 tỉnh, 19.662 byte. `sample.json` là 11 vùng (Đông Nam Á và VN-SG), 13.626 byte. Mỗi feature có `id`, `name`, `name_vi`, `name_en`, `level`. README ghi nguồn và phiên bản. Test đọc file đã commit, không tải mạng.
6. Ghim đặt ở điểm gần giữa hình, không lấy mũi bắc. Việt Nam là `[106.549, 17.205]`. Nhãn nước láng giềng chồng nhau thì ẩn nhãn đến sau. Phần này là JavaScript trong template, không đụng CSS.
7. `shotVariants` ghi tham số từng cảnh (zoom, highlight, style, reveal, marker, …) vào thống kê render. `kindShare` thêm bốn khoá, mặc định 0 để plan cũ vẫn đọc được.
8. Sáu kind đồ hoạ cộng lại không quá 30% thời lượng. Chữ động thường bị gỡ trước, rồi chart và bốn kind mới. Chữ động mở đầu được giữ.
9. Sau khi bốn khung HyperFrames thật chạy xong, engine mặc định là compose. `resolveEditEngine` đổi giá trị trống thành `"compose"`. Chọn Cổ điển ghi `engine: "legacy"`. Dự án cũ không ghi engine sẽ dựng bằng compose.
10. Tab render hiện tên tiếng Việt cho bốn kind mới. ECO tắt cả nhóm đồ hoạ, lý do `+mode-off`.

Thời lượng: map 2,5–7 giây, compare 2,5–6 (cùng lúc là 2), quote_full 3–10, list_full `0,8×n+0,8` đến 12. Chữ động và chart giữ 1,5–6. Mã LLM: map `m`, compare `v`, quote_full `q`, list_full `l`.

## Bản đồ

Admin-1 110m và 50m của Natural Earth v5.1.2 không có tỉnh Việt Nam. `vn.json` lấy admin-1 10m, cùng phiên bản v5.1.2. Bỏ ba vùng lớn VN-39, VN-53, VN-66. Tên tiếng Anh còn dấu tiếng Việt thì gấp về ASCII. Rút gọn Douglas-Peucker dung sai 0,12°, làm tròn 2 số, tách đường qua kinh tuyến 180. Cạnh đóng của Nam Cực từ `[180, −84.71]` sang `[−180, −84.71]` là vĩ tuyến 84°S, giữ nguyên.

Cảnh cấp quốc gia bỏ feature cấp tỉnh và cắt theo khung nhìn. Cảnh cấp tỉnh chỉ giữ tỉnh và nước mẹ. Geo gửi xuống template không quá 150 KiB. LLM không phải gửi cả file geo.

## Kiểm tra

`npm run typecheck` toàn workspace đạt trong phiên này, trước lần test lúc 01:01 giờ Bangkok (UTC+7) ngày 12/11/2026.

`npm test` bắt đầu 01:01 giờ Bangkok (UTC+7) ngày 12/11/2026:

- `@vg/shared`: 593 đạt.
- `@vg/mcp`: 19 đạt.
- `@vg/server`: 938 đạt, 4 bỏ qua, 5 lỗi.
- `apps/web`: 179 đạt, 5 lỗi.

Năm lỗi server và năm lỗi web nằm ở file phần này không sửa:

- `test/originality.test.ts` (4): `buildTimeline` đọc `scene.visuals` trong khi fixture truyền `visual: null`.
- `test/publishing.test.ts` happy path: `evaluatePublishGuardrail` gọi `OriginalityService.recheck`, không khớp hash timeline nên đăng `private`. Test mong `public`.
- `RenderPanel.test.tsx` (5): `OriginalityCard` gọi `data.findings.filter` khi mock fetch không trả `findings`, component đổ và màn hình trống.

Test của phần nối dây nằm trong số đạt: schema, thời lượng, geo, đạo diễn, engine mặc định, form kiểu dựng. Fixture pipeline ghim `edit.engine: "legacy"` để suite render cổ điển không đi vào HyperFrames.

Sau suite đó, tab render thêm nhãn tiếng Việt cho bốn kind. `npm run typecheck` trong `apps/web` đạt ngay sau đó. Nhãn không đổi assertion của suite.

Khung HyperFrames thật, 1280×720, 30 fps, MP4 nháp, thư mục tạm, bắt đầu 00:56 giờ Bangkok (UTC+7) ngày 12/11/2026:

| Kind | Byte | Giây |
| --- | ---: | ---: |
| map | 45.160 | 21,3 |
| compare | 29.680 | 21,7 |
| quote_full | 80.704 | 9,2 |
| list_full | 84.624 | 8,8 |

Lần 12 fps lỗi vì `--start`/`--end` chỉ nhận 24, 25, 30 hoặc 60. Chưa dựng một video dự án 45–90 giây bằng cả hai engine. Chưa mở form kiểu dựng trên trình duyệt. Form được kiểm bằng `EditStyleFields.test.tsx`. Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`. Không commit.

## Còn lại so với TASK-070 đầy đủ

Luật đạo diễn vẫn chỉ phát still, footage, chữ động và chart. `pickDirector` vẫn là baseline. Chưa nối đạo diễn 067b. Chưa có API hay UI sửa từng cảnh. `features.ts` chưa đọc `engine`, `shotsPerMin`, `stillShare`, `graphicShare`, `beatCutPct`, `hookShotKind`, `kindEntropyBits`. Bốn kind mới chỉ vào thống kê qua `kindShare` và `shotVariants`.

## Việc cho Fable

Đã xem template và một khung cuối mỗi kind ở 1280×720. Chưa xem chuyển động bằng mắt.

- Bản đồ là equirectangular. Nga, Fiji và đường qua kinh tuyến 180 bị kéo hoặc tách. Cảnh quốc gia cắt theo khung zoom, không có một thế giới được thiết kế riêng. Nước không có láng giềng trong khung trông trống.
- VN-SG sau dung sai 0,12° còn rất ít điểm. Mẫu thành phố có thể trông trống dù ghim đã ở giữa hình.
- CSS vẫn viết hoa tên láng giềng. Phần va chạm chỉ ẩn nhãn, không đổi kiểu chữ.
- Compare: người thắng màu olive, và versus khi không có người thắng, trông phẳng.
- List kiểu pop yếu hơn bar. Bar nên là mặc định.
- Compare viết hoa nhãn. Quote tách từ theo khoảng trắng. CJK, Ả Rập và Thái chưa được xem.
- Câu mẫu Franklin là 12 từ, không phải 10. Câu Churchill đúng 28 từ và 131 ký tự, sát trần hợp đồng.
