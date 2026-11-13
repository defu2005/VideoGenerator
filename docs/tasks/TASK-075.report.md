# TASK-075

Mode `composeGraphics`: ECO off, BALANCED static, QUALITY animated, MAX animated + `graphicGrain`. CUSTOM lấy hai field này từ QUALITY, phần còn lại từ BALANCED. Không thêm dependency, không đổi DB.

Đồ hoạ toàn cảnh xuất MP4 `standard`. Probe khớp width/height/fps/số khung/yuv420p/h264 thì bỏ lần ffmpeg thứ hai. Static lấy một khung ở `duration − 0.2s` (`--start/--end`), rồi ffmpeg lặp, fade 0,2s, zoom bằng scale/crop (zoompan 1080×1920 chậm ngang animation). `off` đổi span đồ hoạ thành footage hoặc still, lý do kết thúc `+mode-off`. Cache cảnh gồm plan, hash asset, màu, ngôn ngữ, project, mode, grain, fps, format, quality, kích thước, `COMPOSE_RENDER_VERSION`. Concurrency mặc định 1; `COMPOSE_GRAPHIC_CONCURRENCY` là số nguyên ≥ 1. Huỷ thì giết process và xoá file tạm.

Ước tính `estimateRenderSeconds`, ±40%, hiện trên tab Render, `GET /render-estimate`, compose-plan, `run_pipeline` (cả pipeline hoặc RENDER) và `compose_plan_preview`.

## EVAL 1080×1920 (s/phút, đo / dự đoán)

ECO off: explainer 29,6/33,4; listicle 30,8/35,4; story 26,8/31,1.
BALANCED static: 93,8/36,3; 120,8/40,3; 73,3/33,8.
QUALITY animated: 114,1/105,8; 149,5/115,3; 87,0/71,3.
QUALITY không vượt quá 40% so với dự đoán (listicle +30%). Static cao hơn dự đoán khoảng 2–3 lần: mỗi shot vẫn mở browser.

## Bỏ qua

JPEG 95 không có cờ CLI HyperFrames 0.9.14 (`--quality standard`, CRF 18; jpegQuality engine vẫn 80). Không hạ fps. Không tái sử dụng browser. Overlay alpha giữ format cũ.

## Kiểm tra

`npm test` ngày 11/11/2026 khoảng 14:51 giờ Bangkok: shared 564, mcp 19, web 183 đạt. Server 913 đạt, 4 bỏ qua; `connections.test.ts` timeout hook khi chạy cả suite, chạy riêng thì 18 đạt. `npx tsc` server còn lỗi ngoài task: `knowledge/milestones.ts`, `services/visualService.ts`.
