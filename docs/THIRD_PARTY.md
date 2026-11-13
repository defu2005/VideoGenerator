# Thư viện bên thứ ba

Đang gắn trong app:

- `hyperframes@0.9.14` — Apache-2.0. Render HTML thành video. https://github.com/heygen-com/hyperframes
- `gsap@3.15.1` — GSAP standard, không tính phí cho sử dụng thương mại thông thường. File `gsap.min.js` được copy vào thư mục render, không tải từ CDN.
- `@fontsource/be-vietnam-pro@5.3.0` — OFL-1.1. Font tiếng Việt nhúng cục bộ.
- `ffmpeg-static@5.3.0` — gói npm và binary FFmpeg đi kèm là GPL-3.0-or-later. App gọi binary bằng process. Một người chạy trên máy của họ. Không thêm codec ngoài bản binary này.
- `ffprobe-static` — đi cùng bước kiểm tra file render.

Đã xem và không gắn (dùng cá nhân, 2026-11-06). Lý do nằm ở `docs/ARCHITECTURE.md` mục 11.

- Motion Canvas — MIT, trùng HyperFrames
- Remotion — miễn phí có điều kiện (cá nhân hoặc tổ chức tối đa 3 người), trùng HyperFrames và FFmpeg
- PySceneDetect — MIT, cắt scene đã có timeline và job `CLIP`
- WhisperX — BSD, cần GPU; mốc từ đã có từ TTS khi provider hỗ trợ
- OpenMontage (`calesthio/OpenMontage`) — AGPL-3.0 trên repo chính. Một mirror khác ghi MIT không phải nguồn này
- Postbase — self-host được, cần Postgres và API key mạng; app đã có publisher riêng
- n8n Community Edition — Sustainable Use License, không nhúng
- Mastra — core miễn phí; app đã có trợ lý và operator
