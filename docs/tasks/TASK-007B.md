# TASK-007B — Thêm nguồn ảnh (và video clip)

> Trạng thái: **ghi chú / chưa giao**. Phụ thuộc TASK-007 (image store, review UI).

## GOAL
Tăng độ phủ ảnh cho mọi loại chủ đề. Hiện có Wikimedia + Openverse (Pexels có code nhưng thiếu key) — mạnh về tư liệu, yếu về ảnh đời sống / stock đẹp.

## NGUỒN MỚI (provider theo interface của TASK-006)

| Nguồn | Key | Mạnh về | License / ghi chú |
|---|---|---|---|
| Pixabay | API key miễn phí | stock ảnh + **video clip** | Pixabay Content License; cấm hotlink lâu dài → tải về local (đã có image store) |
| Unsplash | Access key | ảnh stock chất lượng cao | Unsplash License; **bắt buộc** gọi `download_location` khi chọn ảnh + ghi "Photo by X on Unsplash" |
| NASA Image and Video Library | không | vũ trụ, khoa học | đa số public domain; kiểm tra trường `photographer`/`center` |
| The Met Open Access | không | nghệ thuật, lịch sử | CC0 khi `isPublicDomain` |
| Library of Congress | không | lịch sử Mỹ, ảnh cổ | chỉ lấy item có "No known restrictions" |
| Smithsonian Open Access | api.data.gov key | bảo tàng, tự nhiên | CC0 khi `usage.access = CC0` |
| Europeana | API key miễn phí | di sản châu Âu | lọc `reusability=open` |
| Flickr | API key | ảnh đời thường đa dạng | chỉ license CC/PD (lọc theo `license` id) |
| Pexels Videos / Pixabay Videos | dùng key ở trên | **B-roll video** | chuẩn bị cho TASK-011/012 (clip thay Ken Burns) |

Tìm ảnh trên web (Brave Search API, license `UNKNOWN`) **được thay bằng chế độ "Nhờ AI tìm" — TASK-007C**.

## REQUIREMENTS (tóm tắt)
- Mỗi provider: rate limiter, timeout, cache, map license về `LicenseSchema`, `attribution` đầy đủ, tôn trọng điều khoản (Unsplash download ping, không hotlink).
- Cấu hình trong `.env.example` + trang Cài đặt → "Nguồn ảnh" (bật/tắt từng nguồn, trạng thái "thiếu key", số lượt/phút).
- Chọn nguồn theo chủ đề (luật, 0 LLM): khoa học/vũ trụ → ưu tiên NASA; lịch sử/nghệ thuật → Met/LoC/Smithsonian/Europeana; đời sống → Pexels/Unsplash/Pixabay.
- Phát hiện watermark nâng cao (sau).
- Test: mock HTTP fixture cho từng provider; không gọi mạng thật trong test.
