# RESEARCH-075 — Tốc độ render đồ hoạ

Kiểm và đo **2026-11-11**. Khuyến nghị: giữ HyperFrames, xuất **MP4 opaque 30 fps** cho compose full-scene; thêm static cho BALANCED. Chưa đổi code app.

Máy: Intel Core i5-13500H, 12 core/16 logical; RAM 15,64 GiB; Windows 11 Home Single Language 10.0.26300. Node v24.19.0; HyperFrames **0.9.14**; Chromium **152.0.7977.30**; Puppeteer-core 25.16.0; FFmpeg 6.1.1 Gyan essentials.
Phương pháp: 3 s/90 frame, 1920×1080 và 1080×1920, bold kinetic v0/v1 + bar chart v0, 3 lượt mỗi cấu hình, trung vị; CPU/RAM cây process được lấy mẫu. Kiểm tải trước lượt, đợi và chạy thêm validation. Tải nền tăng trong lúc đo vẫn gây outlier; giữ dãy số trong [profile.md](profile.md).
HF mặc định dùng Intel D3D11, encoder CPU; prototype ASS/canvas CPU-only. Mỗi script/video/PNG/log nằm OS temp, không render project thật, không sửa cấu hình người dùng.

| Setting, portrait chữ 3 s | s/shot median | s/min nếu 20 shot 3 s* | Hình ảnh / giới hạn |
|---|---:|---:|---|
| Cũ: WebM alpha, bold v0 | 28.15 | 563.0 | GSAP đầy đủ; còn thêm graphic encode ~0.584 s |
| Cũ: WebM alpha, bold v1 grain | 44.09 | 881.9 | Texture/gradient nặng hơn; không quy toàn bộ chênh lệch cho noise |
| MP4 draft 30fps v0, CLI validation | 13.49 | 269.9 | Giữ animation; lossy JPEG/H.264, không alpha |
| MP4 draft 30fps v1 bỏ grain, CLI validation | 13.92 | 278.5 | Giữ layout/animation; draft CRF28 chưa là preset QUALITY |
| MP4 standard/JPEG95 30fps v0, producer API | 17.11 | 342.1 | Combo QUALITY đã đo; ít CLI overhead, CRF18/medium |
| Static PNG cold + FFmpeg motion | 2.06 | 41.1 | Tổng hai median, chưa cộng cold Node/import; không chữ theo lời |
| Native canvas prototype | 2.72 | 54.4 | CPU-only; layout khác, cần viết lại/kiểm chất lượng |
| ASS prototype | 0.66 | 13.3 | CPU-only; nền/animation giản lược |

*Chỉ chuẩn hoá microbenchmark đồ hoạ nối tiếp, **không phải** thời gian cả pipeline hay các fixture; startup được tính lại mỗi shot (static chưa cộng cold Node/import). Các pass app bổ sung ghi riêng. Bảng đầy đủ cảnh ngang/dọc, workers, fps, grain, warm lease và concurrency: [profile.md](profile.md).

Mặc định đề xuất: ECO off; BALANCED static; QUALITY animated standard/JPEG95 30fps/grain off; MAX cùng preset/grain theo variant; CUSTOM chọn từng tham số. Dự báo **compose** s/min ở 1080×1920 (explainer / listicle / story):

- ECO: 33.4 / 35.4 / 31.1.
- BALANCED: 36.3 / 40.3 / 33.8.
- QUALITY: 105.8 / 115.3 / 71.3.
- MAX: 129.8 / 139.3 / 83.1.

Các số fixture là mô hình từ microbenchmark, **chưa render end-to-end 1080p**; công thức, shot counts, giả định, phần chưa tính và sai số ở [modes.md](modes.md). Không dùng để cam kết SLA video 10 phút.

Ưu tiên theo lợi ích/công sức, chất lượng giữ trước:

1. MP4 opaque + bỏ graphic reencode khi stream đã đúng: gain đo ở bảng; sửa apps/server/src/compose/hyperframes.ts, render/graphic.ts (chỉ compose full-scene; overlay alpha giữ riêng).
2. Static final-state PNG + fade/zoom: gain lớn nhất khi chấp nhận mất kinetic timing; sửa compose/hyperframes.ts, render/graphic.ts, packages/shared/src/budget/modes.ts; cần kiểm fonts/layout/safe zones (prototype có ngắt dòng khác HF).
3. Cache đúng trước khi mở rộng: sceneClip.ts thiếu brandColor/accentColor/language/projectId trong key (đã kiểm đổi context vẫn byte-identical). Bổ sung key renderer/font/mode/quality; services/composeBridge.ts và renderService.ts truyền context. Không cache text-only.
4. Một process giữ session/anchor lease có cleanup và queue giới hạn: hyperframes.ts, sceneClip.ts. Pool mặc định đóng browser khi lease cuối release; fixed anchor giảm launch nhưng chưa nhanh hơn rõ trong phép đo. Concurrency nhóm 1/2/3/4 đã đo, chọn trần theo RAM thực; không mặc định workers=16.
5. Grain opt-in và estimate UI: assets/compose/common.js, budget/modes.ts, services/renderService.ts, apps/web/src/features/render/RenderPanel.tsx. Không hạ fps mặc định vì chưa có gain ổn định. QUALITY/MAX dùng standard CRF18/JPEG95 đã đo, không draft CRF28. Native canvas chỉ đề xuất pilot tiếp, không thay engine ngay.

[Alternatives](alternatives.md): licence/Windows/độ trưởng thành/chi phí viết lại và speed hoặc null cho FFmpeg, ba Node canvas, Lottie native/web, Motion Canvas, Remotion (giấy phép công ty riêng). Không copy mã GPL hay thêm npm dependency vào app.
[knowledge.json](knowledge.json): 5 dependency entries đúng TASK-073 §2; đã parse bằng KnowledgeEntrySchema và parseKnowledgeImport. Version libass nhúng chưa xác định: null. Nguồn chính thức kèm ngày kiểm; không quote nguyên văn.

Chưa đo: tốc độ renderer thay thế chưa có bản port tương đương (null), mọi variant/chart type, DSF khác 1, encoder GPU, batch CLI riêng, full hậu kỳ/audio/subtitles/mux 3 fixture, tỷ lệ cache project người dùng (không đọc data/). Prototype static đi trực tiếp Puppeteer, chưa benchmark wrapper production. Không dùng số marketing upstream để lấp dữ liệu thiếu.
Ảnh so sánh mỗi setting và scripts/raw JSON ở thư mục temp gốc, ảnh ở C:/Users/defu/AppData/Local/Temp/vg-research075-636e9fa7bc3648db8713008a021a35dc/comparisons (TEMP có thể bị dọn); liên kết trong profile.md. Đã xem ảnh final-state và prototype; PNG không chứng minh độ mượt.
Phạm vi repo: chỉ README.md, profile.md, alternatives.md, modes.md, knowledge.json và marker .done trong thư mục này. Không chạy build/test workspace cho research-only, không commit/push/install repo.
