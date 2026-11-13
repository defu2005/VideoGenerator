# Profile render đồ hoạ — RESEARCH-075

Ngày đo/kiểm nguồn: **2026-11-11**. Máy và phương pháp tổng quát ở [README](README.md). Đơn vị thời gian là giây thực; mỗi ô là trung vị 3 lượt nếu không ghi khác.

## 1. Đường hiện tại và thời gian thành phần

Gọi CLI giống app trên các bản sao template trong OS temp: 3 giây × 30 fps = 90 frame; workers=1, quality=draft, WebM VP9 alpha trên Windows. Không dùng DB, mạng, LLM/TTS hay project thật. Chữ: style bold, 6 từ trong hai source lines; từ vào ở 0/0,36/0,72/1,08/1,44/1,80 s, nhấn từ thứ ba. Chart: bar, nhãn Năm 2023/2024/2025, giá trị 24/48/75 %. Font Be Vietnam Pro, safe zones và màu lấy từ graphicVariables của app.

| Cỡ / mẫu | 3 lượt wall | Trung vị | Đến lần launch đầu | Tổng launch browser | Tổng page.goto | Init/fonts/layout* | Capture/90 frame | ms/frame | Encode (chồng lấp) | Drain cuối | Peak RSS cây (MiB) | CPU toàn máy % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| wide-kinetic_text-v0 | 27.738 / 24.565 / 25.562 | 25.562 | 3.699 | 0.344 | 0.590 | 0.655 | 20.892 | 232 | 20.872 | 0.873 | 1667 | 51.4 |
| wide-kinetic_text-v1 | 46.653 / 44.730 / 42.542 | 44.730 | 4.063 | 0.394 | 0.604 | 0.788 | 39.506 | 439 | 39.174 | 0.901 | 1715 | 37.8 |
| wide-chart-v0 | 24.997 / 24.844 / 23.946 | 24.844 | 3.763 | 0.341 | 0.568 | 0.692 | 19.762 | 220 | 19.741 | 0.699 | 1654 | 42.1 |
| portrait-kinetic_text-v0 | 28.725 / 26.887 / 28.148 | 28.148 | 3.940 | 0.326 | 0.603 | 0.719 | 23.602 | 262 | 23.576 | 0.700 | 1640 | 49.4 |
| portrait-kinetic_text-v1 | 44.093 / 43.683 / 44.408 | 44.093 | 3.541 | 0.322 | 0.593 | 0.776 | 39.110 | 435 | 39.086 | 0.978 | 1747 | 37.4 |
| portrait-chart-v0 | 28.915 / 29.412 / 28.666 | 28.915 | 4.099 | 0.354 | 0.579 | 0.659 | 23.668 | 263 | 23.644 | 0.695 | 1633 | 43.8 |

*Init là đồng hồ gộp sẵn của HF; chưa tách riêng thời gian font khỏi layout. page.goto gồm trang probe/capture. Các cột có phần trùng nhau, **không cộng để ra wall**. Encode streaming chạy đồng thời với capture; drain là phần chờ encoder cuối. Instrument cài bằng --import trong temp, bọc Puppeteer launch/newPage/goto/CDP và spawn FFmpeg; đồng hồ process tính từ trước Popen đến exit, lấy mẫu tài nguyên khoảng 0,4 s/lượt.

Capture baseline: HF báo drawElement fast path (canvas drawElement/toDataURL) và browser manager báo screenshot fallback trên Windows; đây là hai tầng, không phải cả 90 frame đều qua CDP screenshot. CDP Page.captureScreenshot PNG được thấy ở boundary/verification. Không có BeginFrame trong lượt Windows này. Renderer GPU thực tế d3d11/intel, VP9/H.264 encoder CPU. CaptureAvg gồm seek/capture/đợi encode; không thể xem nó là pure screenshot latency.

| Mẫu | Seek ms/frame | CaptureScreenshot ms/frame (HF) | Capture setup s | Compile s | Assemble s | Min RAM trống trong run (GiB), trung vị |
|---|---:|---:|---:|---:|---:|---:|
| portrait-chart-v0 | 9 | 162 | 0.471 | 0.165 | 0.004 | 0.88 |
| portrait-kinetic_text-v0 | 8 | 158 | 0.520 | 0.131 | 0.004 | 1.11 |
| portrait-kinetic_text-v1 | 11 | 329 | 0.464 | 0.141 | 0.005 | 1.05 |
| wide-chart-v0 | 7 | 130 | 0.485 | 0.166 | 0.004 | 0.90 |
| wide-kinetic_text-v0 | 6 | 139 | 0.418 | 0.148 | 0.004 | 0.50 |
| wide-kinetic_text-v1 | 11 | 308 | 0.545 | 0.190 | 0.005 | 0.95 |

Khoảng 3,5–4,1 s trước browser đầu là Node/module/preflight/CLI, không phải riêng khởi động Chrome (~0,3–0,4 s tổng các launch). Nút thắt là capture + codec trung gian alpha, không phải chép font. Bản thân template đã phủ nền kín, nên compose full-scene có thể xuất opaque MP4; không áp dụng đề xuất này cho overlay cần alpha.

### Việc app làm thêm

| Tác vụ riêng | 3 lượt s | Trung vị s | Ghi chú |
|---|---|---:|---|
| asset-prepare-copy | 0.038 / 0.036 / 0.038 | 0.038 | Hàm app thật, callback chỉ copy clip đã đo; trừ thời gian callback; gồm chuẩn bị và cleanup |
| app-extra-encode | 0.584 / 0.599 / 0.581 | 0.584 | WebM → H.264 theo graphic.ts, 90 frame |
| app-scene-concat | 0.572 / 0.567 / 0.643 | 0.572 | Concat/reencode một clip 3 s theo sceneClip.ts |
| media-still | 1.598 / 1.399 / 1.487 | 1.487 | renderStill thật, PNG 1080p, push_in |
| media-footage | 0.773 / 0.756 / 0.840 | 0.773 | renderFootage thật; synthetic input 320×180, scale/crop lên 1080p |

Các phép đo FFmpeg ở bảng này gồm process start. Concat chỉ đo cảnh 3 s một clip; mô hình fixture ngoại suy theo độ dài, chưa đo lại toàn bộ hậu kỳ/audio/subtitles. Footage input thấp hơn source thực có thể làm estimate lạc quan.

## 2. Tuỳ chọn HyperFrames 0.9.14

Kiểm CLI help và source đã cài; tài liệu main có thể mới hơn bản đo. Chưa nâng HF (registry latest lúc kiểm: 0.9.32).

- Batch: CLI có --batch, --batch-concurrency (mặc định 1). Engine có acquireBrowser/release và browser pool, nhưng khi refCount về 0 nó đóng browser; chỉ giữ process chưa đủ. Cần giữ một anchor lease cùng launch fingerprint hoặc capture-session riêng để dùng browser qua nhiều composition. App hiện spawn CLI mỗi shot nên mất pool. Public hyperframes/api không cung cấp nguyên API render dùng ở prototype; thử nghiệm warm dùng chunk producer/engine nội bộ, cần pin version/wrapper khi triển khai.
- Workers chia frame/chunk và có calibration theo CPU/RAM; coresPerWorker=2.5, minParallelFrames=120 trong config. Cảnh này chỉ 90 frame: workers auto không có nghĩa dùng đủ 16 logical cores. Có frame-range start/end; tự chia cần ghép đúng frame, variables và timeline toàn cục.
- Windows không có fast BeginFrame headless-shell như nhánh Linux; forceScreenshot/useDrawElement, format png/jpeg và jpegQuality là engine config. Opaque MP4 cho phép JPEG; WebM alpha dùng PNG/VP9. --quality draft không có nghĩa đổi độ phân giải.
- Browser --browser-gpu auto/probe và --no-browser-gpu/SwiftShader khác với --gpu chọn encoder. Software được thử; hardware Intel được thử ở auto. Không đo NVENC/QSV hay GPU khác.
- DSF giữ 1. Resolution/DPR khác aspect hoặc scale không nguyên có ràng buộc; drawElement route bị hạn chế khi DSF≠1. Không dùng supersampling để tăng tốc. Chưa đo DSF khác vì yêu cầu giữ đúng 1080×1920.

| Portrait bold v0 / setting | Đường gọi | 3 lượt s | Median s | × so WebM v0 | Peak RSS MiB | CPU toàn máy % |
|---|---|---|---:|---:|---:|---:|
| mp4 | cli | 15.555 / 15.606 / 22.608 | 15.606 | 1.80 | 862 | 39.7 |
| fps15 | cli | 12.096 / 19.939 / 18.644 | 18.644 | 1.51 | 790 | 41.2 |
| fps24 | cli | 12.616 / 22.493 / 17.406 | 17.406 | 1.62 | 811 | 35.0 |
| workers2 | cli | 13.586 / 21.304 / 19.140 | 19.140 | 1.47 | 1178 | 41.0 |
| workers4 | cli | 14.422 / 20.544 / 13.476 | 14.422 | 1.95 | 2275 | 43.7 |
| screenshot | producer | 13.137 / 12.558 / 101.338 | 13.137 | 2.14 | 639 | 41.3 |
| jpeg95 | producer | 14.344 / 12.548 / 61.338 | 14.344 | 1.96 | 661 | 42.8 |
| software | producer | 13.827 / 12.167 / 15.691 | 13.827 | 2.04 | 593 | 46.6 |

Validation riêng sau nhóm benchmark, cùng CLI MP4 30fps/1worker, gate tải nền được cải tiến:

| Setting | 3 lượt s | Median s | Pre CPU cuối % |
|---|---|---:|---|
| validation-mp4 | 13.467 / 13.493 / 15.583 | 13.493 | 16.6/24.0/18.5 |
| validation-nograin | 13.391 / 13.925 / 13.994 | 13.925 | 13.3/16.7/17.2 |

### Combo giữ chất lượng: MP4 standard + JPEG95 + 30 fps

Preset draft MP4 thực tế là libx264 ultrafast CRF28, 16 encoder threads; standard là medium CRF18, high là fast CRF15 trong source engine. CRF giữa VP9 và H.264 không tương đương. Vì vậy đo thêm standard/JPEG95 bằng producer API cho khuyến nghị QUALITY/MAX; không nhận gain draft là gain ở cùng chất lượng.

| Mẫu premium | 3 lượt s | Median s | Peak RSS MiB | CPU % |
|---|---|---:|---:|---:|
| premium-text0 | 17.096 / 17.599 / 17.107 | 17.107 | 1446 | 38.6 |
| premium-text1 | 22.296 / 22.186 / 22.209 | 22.209 | 1521 | 38.4 |
| premium-chart0 | 18.050 / 17.014 / 15.772 | 17.014 | 1492 | 39.7 |
| premium-chart1 | 22.338 / 22.337 / 23.203 | 22.338 | 1556 | 41.8 |

Cả bốn là process producer độc lập, không anchor lease, GPU auto Intel, 1 worker. API có ít CLI overhead; JPEG95/standard tăng chất lượng encode so với draft. Đây là combo nhiều thay đổi đã đo, không cô lập gain từng flag. Concurrency nhóm ở dưới dùng draft; chưa suy ra RAM/throughput premium song song.

CLI giữ nguyên preflight so baseline; producer bỏ một phần CLI overhead. Vì vậy không quy toàn bộ gain của screenshot/software cho capture flag. screenshot=forceScreenshot/useDrawElement:false, jpeg80 mặc định; jpeg95 cùng đường đó. software dùng producer + SwiftShader. Lượt screenshot 101,338 s và jpeg95 61,338 s vẫn được giữ trong dãy, không xoá để làm đẹp số.

| Hạ fps rồi FFmpeg fps=30 | HF median s | Chuyển đổi 3 lượt s | Tổng median thành phần s |
|---|---:|---|---:|
| fps15 | 18.644 | 0.850 / 0.811 / 0.771 | 19.456 |
| fps24 | 17.406 | 0.867 / 0.867 / 0.881 | 18.273 |

24 fps lặp frame lên 30, không sinh thêm chuyển động; bước thời gian tối đa 41,7 ms thay vì 33,3 ms. 15 fps thành 66,7 ms, rõ hơn ở từ xuất hiện/bar tăng. PNG chỉ kiểm nét/bố cục, không chứng minh mượt theo thời gian. Số đo hiện tại không cho lợi ích median chắc chắn khi hạ fps; giữ 30 fps mặc định, 24/15 chỉ CUSTOM và cần preview. Pair PNG baseline/candidate được lưu cho từng setting tại comparisons (đường dẫn dưới).

### Một process qua ba mẫu khác nhau: mặc định và giữ anchor lease

| Trial | Tổng 3 shot s | v0 s | v1 s | chart s |
|---|---:|---:|---:|---:|
| default 1 | 28.676 | 9.188 | 11.172 | 8.316 |
| default 2 | 26.989 | 8.227 | 10.653 | 8.109 |
| default 3 | 27.240 | 8.291 | 10.638 | 8.310 |
| anchor thử 1 (không reuse) 1 | 29.422 | 9.137 | 11.382 | 8.705 |
| anchor thử 1 (không reuse) 2 | 31.553 | 8.631 | 11.701 | 11.034 |
| anchor thử 1 (không reuse) 3 | 29.354 | 8.544 | 11.615 | 9.041 |
| anchor fingerprint đúng 1 | 30.988 | 11.313 | 11.145 | 8.298 |
| anchor fingerprint đúng 2 | 27.155 | 8.114 | 10.869 | 7.995 |
| anchor fingerprint đúng 3 | 27.764 | 8.208 | 11.151 | 8.220 |

Sequence MP4 30 fps, 1 worker, đo sau import module. Default vẫn launch capture browser mỗi job vì lease cuối release; metrics có 10 launch/9 job (gồm GPU probe). Anchor thử 1 lấy args sau Puppeteer đã mutate nên fingerprint thiếu feature flags và không reuse (13 launch). Lượt fixed dùng bản sao args đầy đủ từ validation, cùng executable/timeouts; giữ lease ngoài loop rồi release/drain ở cuối. Launch count được đối chiếu ở appendix. Không phải phép A/B batch CLI tương đương hoàn toàn; chưa có số riêng cho --batch. Giữ process giúp tránh module/preflight; giữ browser chỉ tiết kiệm launch, không xoá capture. Không nhận toàn bộ gain API so CLI là gain browser.

## 3. Các thay đổi mình kiểm soát

### Static: template gốc, seek final state rồi PNG

Chụp original HTML/GSAP sau document.fonts.ready và seek timeline main tới 2,8 s; không chụp frame 0. Prototype dùng Puppeteer + cached Chromium đã cài, file:// assets local, software raster, DSF=1. Bỏ CLI/compiler/90-frame loop. Đây là hướng triển khai cần wrapper và kiểm font/ready; không phải số đo lệnh HF render --duration 0. Một lỗi stub truyền object ban đầu gây ảnh trống đã được phát hiện bằng xem PNG, sửa và **đo lại cả 18 lượt**; không dùng các số trống đó.

| Mẫu | PNG cold 3 lượt s | Median cold s | Median warm s | FFmpeg motion s | Tổng cold thành phần s |
|---|---|---:|---:|---:|---:|
| kinetic_text-v0 | 0.837 / 0.782 / 0.836 | 0.836 | 0.726 | 1.221 | 2.057 |
| kinetic_text-v1 | 1.261 / 1.226 / 1.260 | 1.260 | 1.963 | 1.478 | 2.738 |
| chart-v0 | 0.770 / 0.745 / 0.730 | 0.745 | 0.851 | 1.242 | 1.987 |

PNG cold tính launch+page/font/layout+screenshot trong process đã import, không tính cold Node/import; cộng chi phí process nếu vẫn spawn riêng. FFmpeg zoom 1→1,015, fade in 0,2 s, 90 frame. Static giữ style/font/nội dung/số cuối, nhưng ngắt dòng prototype khác HF animated (nguyên nhân chưa xác định), không pixel-equivalent; cần kiểm golden trước triển khai. Nó bỏ chữ vào theo từ và counter/bar animation; do đó phù hợp BALANCED/ECO hơn QUALITY. PNG và animated comparison ở comparisons, đã kiểm hình bằng mắt.

### Grain và combo tốt nhất đã đo

| Variant 1 / đường | 3 lượt s | Median s | RSS MiB |
|---|---|---:|---:|
| base-portrait-kinetic_text-v1 | 44.093 / 43.683 / 44.408 | 44.093 | 1747 |
| nograin-webm | 43.383 / 40.029 / 32.831 | 40.029 | 1662 |
| grain-mp4 | 30.047 / 16.095 / 15.263 | 16.095 | 1127 |
| nograin-mp4 | 202.396 / 14.770 / 12.528 | 14.770 | 855 |

Pre-made grain PNG overlay FFmpeg: 1.275 / 1.339 / 1.329 s, median **1.329 s thêm một pass** trên clip opaque sẵn. Tile LCG seed 20261111 giống common.js, 128px phóng 256px và lặp; prototype dùng nearest nên không coi pixel-identical với CSS scaling. Overlay ở bảng này nằm trên static v0, không phải end-to-end v1 animated.

Grain trong app được tạo **một lần mỗi page**, không sinh noise mới mỗi frame. Phần nặng là overdraw/entropy/capture/codec; không nên diễn giải toàn bộ chênh v0/v1 thành chi phí canvas-noise. Đo bỏ grain giữ nguyên gradient/beam cho thấy chỉ một phần gain; MP4 là thay đổi lớn hơn. Premium standard/JPEG95 ở bảng riêng là combo chất lượng được đề xuất; các số draft chỉ làm mốc so sánh. Combo CLI MP4 opaque + no grain + 30 fps + 1 worker đã đo đủ 3 lượt ở nograin-mp4. Chưa chọn workers4 làm default vì RAM/tải máy.

### Cache và tỷ lệ lặp

| Phép thử | 3 lượt s | Median s |
|---|---|---:|
| template-cache-hit | 0.002 / 0.002 / 0.002 | 0.002 |
| scene-cache-hit | 0.003 / 0.002 / 0.003 | 0.003 |

Template cache được seed bằng copy WebM đã đo vào callback injection, rồi hit hàm app thật; scene cache được tạo từ template-cache đó (không nhận là full cold render). Một lần scene-from-template-cache tốn 1.193 s. Template hit vẫn phải encode graphic + concat khi scene key đổi; scene hit copy file thành phẩm rất nhanh.

Cùng plan/vars/assets/target và render lại nguyên project: tỷ lệ graphic template có thể hit **100%** (suy ra từ key, đã kiểm hit thật trên fixture nhỏ). Nếu thay nội dung đúng một graphic, tỷ lệ còn lại là (G−1)/G: explainer 2/3, listicle 3/4, story 1/2, với giả định không đổi duration/timing/variant các shot khác. Tỷ lệ lặp trong project thực của người dùng: **null**, không đọc data/DB; không dùng tỷ lệ giả làm số thống kê thực.

Key template hash HTML, common.js, full variables, width/height/fps/duration và COMPOSE_VERSION. Full vars/timing cần thiết, không nên cache chỉ bằng text. Có thể canonicalize thứ tự object để tránh miss vô nghĩa; invalidation theo version toàn compose hơi rộng nhưng đúng an toàn. Còn thiếu hash/version GSAP, font bytes và renderer, mode/format/quality/grain khi bổ sung. Scene key hash plan/assets/target/version nhưng **thiếu brandColor/accentColor/language/projectId**. Phép thử đổi đồng thời brandColor/language/projectId vẫn nhận output byte-identical: True. Đây là bug correctness, phải sửa trước khi mở rộng cache/concurrency; chưa sửa app trong research.

### Song song nhiều shot (mỗi shot một producer process MP4, 1 worker)

4 job/trial: v0, chart, v1, v0. Ba trial mỗi mức, có lấy mẫu aggregate RSS/CPU/RAM, kiểm load trước nhóm. Tổng thời gian nhóm gồm process import/encode/close; dùng cùng tập 4 job để so capacity.

| Concurrency | 3 lượt tổng s | Median tổng s | Median s/job | Peak cây MiB (median) | Min RAM trống GiB (min mọi trial) |
|---|---|---:|---:|---:|---:|
| 1 | 42.103 / 45.519 / 47.435 | 45.519 | 11.380 | 1097 | 1.30 |
| 2 | 26.564 / 24.772 / 24.725 | 24.772 | 6.193 | 1948 | 0.75 |
| 3 | 26.406 / 26.982 / 24.782 | 26.406 | 6.601 | 2621 | 0.31 |
| 4 | 19.191 / 20.781 / 19.495 | 19.495 | 4.874 | 3423 | 0.49 |

Không nhân workers trong shot với số shot song song một cách độc lập: ngân sách RAM/CPU phải chung. Đề xuất giới hạn được chốt trong modes.md từ bảng đo, giảm về 1 khi thiếu RAM/tải nền; không dùng số logical core làm concurrency mặc định.

### Dữ liệu thô và tái lập

Mọi script/log/perf/video/ảnh thử ở OS temp (không nằm trong repo):

C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc

Scripts: prepare.mjs, bench.py, instrument.mjs, producer.mjs, extra.py, static.mjs, alternative/canvas.mjs, post.py, warm.mjs, warm-anchor.mjs, groups.py, plans.mjs, media.mjs, finish.py. JSON: results.json, static-results.json, canvas-results.json, post-results.json, warm-results.json, warm-anchor-results.json, warm-anchor-fixed-results.json, group-results.json, media-results.json, fixture-plans.json, fps-convert-results.json. results.json giữ cả failures và pre-run samples; bảng này chỉ tổng hợp exit=0. Temp có thể bị OS dọn; số tổng hợp/3 lượt được giữ trong báo cáo này.

Lệnh đại diện (chạy từ temp, không đọc cấu hình người dùng):

```powershell
node --import <temp>/instrument.mjs <repo>/node_modules/hyperframes/bin/hyperframes.mjs render <temp>/cases/portrait-kinetic_text-v0 --output <temp>/shot.webm --format webm --fps 30 --workers 1 --variables-file <temp>/cases/portrait-kinetic_text-v0/variables.json --quality draft --debug
```

Env chỉ trên process con: DO_NOT_TRACK=1, HYPERFRAMES_TELEMETRY_DISABLED=1, HYPERFRAMES_AUTO_UPDATE=false, FFmpeg/ffprobe path hiện có, PRODUCER_RENDERS_DIR và BENCH_METRICS trỏ temp. Không thêm vào .env. Các phép mới dùng binary đang cài, không chạy npm install trong repo.

### Nhiễu và giới hạn đo

Kiểm CPU một giây trước run; đợi khi >35% hoặc phát hiện heavy ffmpeg/chrome/node. Gate ban đầu tối đa 12 lần, sau cải tiến tới 120 lần, đo chênh CPU process thật và thêm chrome-headless-shell.exe. Gate cũ nhận diện process chưa đầy đủ; tải nền có thể tăng sau lúc bắt đầu. Có lúc toàn máy 92,9%, Defender/WSL/Node khác đang hoạt động, và RAM trống trong baseline có lúc ~0,5 GiB. Không tắt process của người dùng. Các số options/grain chịu nhiễu nhất (nograin-mp4 lượt 0 tới 202,396 s; harness cho tối đa 210 s, app hiện timeout 120 s nên lượt đó sẽ bị app huỷ); giữ min/max, chạy thêm validation riêng khi yên. Cold smoke 51,627 s và smoke lỗi import ban đầu không nằm trong 18 baseline. RSS là tổng working set process tree, có thể đếm trùng shared pages; không nhận là unique physical RAM.

## Nguồn (kiểm 2026-11-11)


- Code app đọc tại thời điểm đo: [hyperframes.ts](../../../apps/server/src/compose/hyperframes.ts), [graphic.ts](../../../apps/server/src/compose/render/graphic.ts), [sceneClip.ts](../../../apps/server/src/compose/sceneClip.ts), [common.js](../../../apps/server/assets/compose/common.js), [EVAL](../../compose/EVAL.md), [067b part 1](../../tasks/TASK-067b-part1.report.md), [part 2](../../tasks/TASK-067b-part2.report.md).
- Source cài tại node_modules/hyperframes/dist/chunk-6ZRGEVAM.js và chunk-FF3VKFCN.js (chỉ đọc) là căn cứ config/capture/pool của **0.9.14**; [upstream repository](https://github.com/heygen-com/hyperframes), [performance](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/performance.mdx), [troubleshooting](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/troubleshooting.mdx), [determinism](https://github.com/heygen-com/hyperframes/blob/main/docs/concepts/determinism.mdx). Không lấy số nhanh chậm của docs upstream làm số đo máy này.
- [FFmpeg filter docs của 6.1.1](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/doc/filters.texi); giấy phép và alternatives ở [alternatives.md](alternatives.md).

## Kiểm output và ảnh so sánh (2026-11-11)

ffprobe -count_frames trên đại diện mỗi loại baseline/validation/fps xác nhận kích thước và số frame. Baseline 30 fps có 90 frame; 15 fps có 45, 24 fps có 72; hai clip chuyển đổi và static có 90 frame ở 30 fps. Đây là kiểm metadata/decode, không phải test toàn app.

| Output | Width × height | FPS | Frame decoded | Pixel format |
|---|---|---|---:|---|
| base-wide-kinetic_text-v0 | 1920×1080 | 30/1 | 90 | yuv420p |
| base-wide-kinetic_text-v1 | 1920×1080 | 30/1 | 90 | yuv420p |
| base-wide-chart-v0 | 1920×1080 | 30/1 | 90 | yuv420p |
| base-portrait-kinetic_text-v0 | 1080×1920 | 30/1 | 90 | yuv420p |
| base-portrait-kinetic_text-v1 | 1080×1920 | 30/1 | 90 | yuv420p |
| base-portrait-chart-v0 | 1080×1920 | 30/1 | 90 | yuv420p |
| validation-mp4 | 1080×1920 | 30/1 | 90 | yuv420p |
| validation-nograin | 1080×1920 | 30/1 | 90 | yuv420p |
| fps15 | 1080×1920 | 15/1 | 45 | yuv420p |
| fps24 | 1080×1920 | 24/1 | 72 | yuv420p |
| chart-grain-mp4 | 1080×1920 | 30/1 | 90 | yuv420p |
| 15-to30 | 1080×1920 | 30/1 | 90 | yuv420p |
| 24-to30 | 1080×1920 | 30/1 | 90 | yuv420p |
| static | 1080×1920 | 30/1 | 90 | yuv420p |
| premium-text0 | 1080×1920 | 30/1 | 90 | yuv420p |
| premium-text1 | 1080×1920 | 30/1 | 90 | yuv420p |
| premium-chart0 | 1080×1920 | 30/1 | 90 | yuv420p |
| premium-chart1 | 1080×1920 | 30/1 | 90 | yuv420p |

Ảnh nằm ngoài repo theo brief; link có thể hết khi OS dọn TEMP. So cùng t=0,533333 s; các setting dưới đây đều có pair baseline/candidate. PNG cuối giúp kiểm font/dấu/safe zone/số, không thay thế xem preview chuyển động.

| Setting | Baseline PNG | Candidate PNG |
|---|---|---|
| fps15 | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/fps15-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/fps15-t0533.png) |
| fps24 | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/fps24-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/fps24-t0533.png) |
| mp4 | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/mp4-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/mp4-t0533.png) |
| screenshot | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/screenshot-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/screenshot-t0533.png) |
| jpeg95 | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/jpeg95-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/jpeg95-t0533.png) |
| software | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/software-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/software-t0533.png) |
| grain-mp4 | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/grain-mp4-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/grain-mp4-t0533.png) |
| nograin-mp4 | [baseline](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/nograin-mp4-baseline-t0533.png) | [candidate](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/nograin-mp4-t0533.png) |

[Contact sheet](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/contact.png), [animated cuối](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/animated-t28.png), [static đầu](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/static-t0533.png), [static cuối](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/static-t28.png), [canvas chữ](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/alternative/kinetic_text-1-84.png), [canvas bar](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/alternative/chart-1-84.png), [ASS chữ](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/ass-kinetic-t15.png), [ASS bar](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/ass-chart-t15.png).

Quan sát: chữ tiếng Việt và nhấn vàng ở HF/static đọc được, static đưa nội dung cuối ra ngay nên mất nhịp mở từng từ. Có khác biệt ngắt dòng: static là Biến dữ liệu / thành câu / chuyện, HF animated là Biến dữ / liệu thành / câu chuyện. Nguyên nhân chưa xác định: null; cần layout-ready/golden check, không nhận hai đường pixel-equivalent. Native prototype không có bộ fit/safe zone của app (chữ sát mép hơn, 2 dòng thay vì 3); không nhận là pixel-equivalent. Grain bị nén/bớt rõ khi xem thumbnail; không dùng ảnh thu nhỏ để kết luận hai format giống hệt. 15/24 fps giữ nội dung/font nhưng sai khác thời điểm/độ mượt cần preview; không khuyên làm default.

Anchor browser: tổng launch ghi nhận 4 cho 9 job/3 trial (có probe nếu chạy); đối chiếu default 10 và anchor thử đầu 13. Sau phát hiện Puppeteer mutate mảng args, instrument đổi sang copy array trước launch; timing/capture của các lượt cũ không đổi. Fingerprint của anchor fixed lấy từ bản sao đầy đủ args capture trong validation, bỏ marker owned-browser; giữ lease ngoài loop rồi release/drain ở cuối. Đây là API nội bộ cần wrapper/pin, không phải đổi source dependency. Dù giảm launch từ 10 xuống 4, median nhóm 3 shot fixed là 27,764 s so default 27,240 s: **chưa chứng minh gain tốc độ**; capture/encode vẫn chi phối, không ưu tiên anchor chỉ để tiết kiệm launch.

Concurrency: median nhóm 1/2/3/4 = 45,519 / 24,772 / 26,406 / 19,495 s. Bốn nhanh nhất trong phạm vi đã đo; ba không thắng hai. **Chưa đo >4, chưa xác định điểm bão hoà thực.** Min available RAM ở 3 có lúc 0,308 GiB, ở 4 là 0,493 GiB. Mặc định 1; 2 khi đủ headroom; 4 là throughput option lúc máy rảnh, không mặc định chung.

Premium standard/JPEG95 đã xem ảnh cuối: [text v0](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/premium-text0-t28.png), [text v1](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/premium-text1-t28.png). Pair cùng thời điểm 0,533333 s: [WebM v0](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/mp4-baseline-t0533.png) / [premium v0](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/premium-text0-t0533.png); [WebM v1](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/grain-mp4-baseline-t0533.png) / [premium v1](C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons/premium-text1-t0533.png). Không có đánh giá VMAF/PSNR hay blind review; chưa nhận hai codec là tương đương cảm nhận.
