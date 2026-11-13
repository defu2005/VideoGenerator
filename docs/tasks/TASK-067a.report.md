# TASK-067a

## Đã làm

Phase A trong `packages/shared/src/compose`: schema, từ, nhịp, chỗ cắt, chỉ số. Phase B: footage Pexels/Pixabay, mẫu HyperFrames, dựng cảnh quay, `baselineDirector`, `planProject`, bài đo.

Sửa file cũ đúng một dòng: `export * from "./compose/index.js"` trong `packages/shared/src/index.ts`.

## Kiểm tra

`npm run typecheck` đạt. `npm test` khoảng 21:54 giờ Bangkok (UTC+7) ngày 10/11/2026:

| Workspace | Kết quả |
| --- | --- |
| shared | 421 đạt |
| mcp | 19 đạt |
| server | 816 đạt, 2 bỏ qua |
| web | 178 đạt |

Bài đo `VG_COMPOSE_EVAL=1` khoảng 21:50 giờ Bangkok, 49 giây. HyperFrames dựng được `kinetic_text`. `npm test` thường bỏ qua bài này.

| Dự án | Chế độ | Cảnh | Khung | Đứng hình | Đen | Giây render / phút |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| explainer | legacy | 4 | 480 | 4 | 0 | 1.8 |
| explainer | baseline | 4 | 480 | 0 | 0 | 4.1 |
| listicle | legacy | 5 | 600 | 5 | 0 | 2.4 |
| listicle | baseline | 5 | 600 | 0 | 0 | 9.5 |
| story | legacy | 4 | 480 | 4 | 0 | 1.9 |
| story | baseline | 4 | 480 | 0 | 0 | 5.9 |

## Khác hướng dẫn

- Pixabay Video API không có `orientation`. Lọc ngang/dọc/vuông bằng `width` và `height` sau khi tải. Trường dùng: `hits[].user`, `pageURL`, `tags`, `duration`, `videos.{large,medium,small,tiny}.{url,width,height,size,thumbnail}`.
- Pexels: `videos[].user.name`, `url`, `image`, `duration`, `video_files[].link/width/height/file_type`. `licenseName` là "Pexels License".
- `FootageHit` thêm `files` để chọn cỡ, và `localPath` khi file đã có trên đĩa. Không thì `path` của cảnh quay để trống.
- Độ tin nhịp là đỉnh tự tương quan đã chuẩn hoá trừ trung vị các lag, để nhiễu trắng dưới 0,3. Tempo lấy khoảng cách trung bình giữa các đỉnh onset, vì lag nguyên của hop 512 không vào ±2 BPM.
- Thời điểm từng từ trên mẫu chữ được rải đều trong cảnh quay. Schema chỉ có `lines`, không có `t` từng từ.
- Test shared nằm cạnh file nguồn nên `tsc` cũng phát chúng vào `dist`.
