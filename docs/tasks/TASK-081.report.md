# TASK-081

Spike thất bại. Không thêm `renderStaticBatch`. Không sửa template, không đổi render.

## Spike

Thư mục tạm, ngoài repo: `C:\Users\defu\AppData\Local\Temp\cursor-task-081\scratchpad`. Chạy khoảng 6:45 giờ Bangkok, 12/11/2026. HyperFrames 0.9.14 đã cài. Chrome headless có sẵn trong cache (`win64-156.0.8078.47`), không tải thêm. Cả hai đường dùng `--no-browser-gpu` (SwiftShader). Kích thước 1280×720, 30 fps, mỗi mẫu dài 3 giây. Khung hoàn tất ở 2,800–2,833 giây, đúng `finishedSeekSec`.

Ba mẫu thật `map`, `compare`, `list_full` nằm nối tiếp trên một timeline gốc. Mỗi mẫu có `data-composition-variables` (default sai, để lộ nếu chỉ rơi về default) và `data-variable-values` riêng: nhãn `ALPHA-MAP`, cặp `BETA-LEFT` / `BETA-RIGHT`, danh sách `GAMMA-LIST`. Một lệnh:

`snapshot --at 2.800,5.800,8.800 --no-end --keep --json`

Ba lần `render --start 2.800 --end 2.833` riêng, cùng biến, cùng `--quality standard`.

### Thời gian

| Lần | Giây |
|---|---|
| map, một mình | 10,6 |
| compare, một mình | 8,7 |
| list_full, một mình | 9,1 |
| Tổng ba lần render | 28,4 |
| Một snapshot, ba mốc | 3,3 |

Snapshot nhanh hơn khoảng 8 lần. Khung hình không dùng được, nên tốc độ không đủ để đi tiếp.

### Khung hình

Ba PNG snapshot đúng 1280×720. So pixel với khung rút từ MP4 từng mẫu:

| Mẫu | Độ lệch kênh trung bình | Pixel lệch hơn 12 | Pixel sáng (Y > 80) snapshot | Pixel sáng lần render riêng |
|---|---|---|---|---|
| map | 7,3 | 14,5% | 0 (Y tối đa 50) | 17.756 |
| compare | 25,0 | 100,0% | 0 (Y tối đa 23) | 39.233 |
| list_full | 14,8 | 50,7% | 0 (Y tối đa 23) | 28.270 |

Lần render riêng có chữ và nét vàng (map có 5.547 pixel vàng). Ba snapshot không có pixel sáng. `at-5.8s.png` và `at-8.8s.png` trùng từng byte. `at-2.8s.png` chỉ hơn hai khung kia một quầng tối (lệch kênh tối đa 34). Log snapshot có `Missing window.__timelines registration.`

Ảnh nằm ở `scratchpad\batch\snaps` và `scratchpad\singles`.

### Biến và `common.js`

Đọc `hyperframes docs compositions` và `docs data-attributes` trước khi dựng. Biến từng instance nằm ở `data-variable-values`. Runtime gộp chúng vào `window.__hfVariablesByComp` theo id mount. Script **inline** của sub-composition được bọc: `document`, `window`, `gsap`, `__hyperframes` là proxy. `getVariables()` trong proxy trả về đúng biến của mount đó.

`common.js` được template nhúng bằng `<script src="common.js">`. Bundler inline file này một lần, không bọc theo mount, vì ba mẫu cùng một đường dẫn. `VGInit` trong file đó đọc `window.__hyperframes.getVariables()` và `document.getElementById("root")` trên trang gốc. Khi ghép, HyperFrames gỡ `id="root"` của root con và để `data-hf-authored-id="root"`. Proxy chỉ map id đó cho script nằm trong bọc.

`VG.finish()` gán `window.__timelines = { main: tl }`, thay cả object và khóa là `main`. Tài liệu GSAP của HyperFrames yêu cầu `window.__timelines[compositionId] = tl` mà không thay object. Proxy chỉ đổi khóa `main` sang id runtime khi gán từng khóa. Gán đè object thì runtime không tìm thấy timeline của từng shot, nên seek không tới khung đã xong. Chữ và nét trong template bắt đầu ở opacity 0, nên khung snapshot chỉ còn nền tối.

Một mẫu đối chứng hai sub-composition, script inline, `getVariables()` và `window.__timelines.main = tl` đúng kiểu tài liệu: snapshot 1,5 giây ra chữ ALPHA nền xanh đen, 4,5 giây ra chữ BETA nền xanh lá. Biến không lẫn khi script nằm trong bọc. Ba template của app thì không ra khung đó.

Muốn batch theo sub-composition thì phải sửa `common.js` (cách lấy root, cách lấy biến, cách ghi timeline). Task cấm sửa `apps/server/assets/compose/**`.

## Việc không làm

Không thêm `renderStaticBatch`. Không đổi pipeline render. Không có test mới, không chạy eval, không sửa `docs/compose/EVAL.md`. Không dependency, không migration, không commit.

## Hướng tiếp

Giữ một browser sống cho cả video, và với mỗi shot tĩnh vẫn nạp đúng tài liệu một mẫu như `renderComposeTemplate` hôm nay (`#root`, `variables.json`, `__timelines.main`). Seek tới khung đã xong, chụp PNG, rồi ffmpeg `staticMotionArgs` như hiện tại. Trang đó là của mình, không nhúng ba mẫu vào một timeline HyperFrames. Cách đó giữ nguyên hợp đồng của template.
