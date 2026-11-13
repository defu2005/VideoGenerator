# TASK-068

## Đã làm

Kế hoạch cảnh quay lưu ở `render/compose-plan.json` và trong `renders.report.compose`. Không thêm bảng, không migration.

Đạo diễn là `baselineDirector`. `directorMode: quality` cũng về baseline vì `llmDirector` chưa có (067b chưa có). Thiếu `engine` thì render vẫn là ảnh tĩnh. Ngân sách ECO ép đạo diễn `eco`.

`RENDER_FORMAT_VERSION` không tăng. Hash clip gồm kế hoạch cảnh, nên bản cổ điển và bản compose không dùng chung clip. Một cảnh compose lỗi thì cảnh đó dựng lại bằng clip ảnh cũ, render vẫn xong, issue `COMPOSE_FALLBACK`.

Cổng render đọc `freezeSegments` và `blackSegments`. Báo cáo cũ không có hai trường này thì tính là 0. Lý do: "video có đoạn đứng hình", "video có đoạn đen".

Công cụ `compose_plan_preview` chỉ đọc, tối đa 12 cảnh, có trên API, assistant, MCP và operator (operator dùng chung assistant). Form kiểu dựng và tab Render hiện thống kê. Credits nối thêm tác giả, giấy phép và trang footage.

## Kiểm tra

`npm run typecheck` đạt. `npm test` xong khoảng 22:19 giờ Bangkok (UTC+7) ngày 10/11/2026:

| Workspace | Kết quả |
| --- | --- |
| shared | 421 đạt |
| mcp | 19 đạt |
| web | 180 đạt |
| server | 820 đạt, 2 bỏ qua |

## Kiểm tra trực tiếp

Project mới `e92375f4-c69e-40fb-9063-ad0baff92002`, 3 giây, 160×90, ffmpeg thật. Không dùng khóa footage. Không đụng project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

| Chế độ | Giây | Byte | Khung | Đứng hình | Đen | Cảnh quay | Cảnh/phút | Ảnh tĩnh | Cắt đúng nhịp |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy | 1.5 | 95147 | 90 | 0 | 1 | 2 | — | 100% | — |
| compose | 2.5 | 79815 | 90 | 0 | 0 | 2 | 40 | 100% | 0% |

Ba khung đầu, giữa, cuối của cả hai bản: chữ "Xin chao" nằm dưới, không đè chữ khác. Cảnh 2 không có ảnh nên khung giữa và cuối tối. Số liệu cũng nằm ở `docs/compose/EVAL.md`.

## Khác hướng dẫn

- Hàm đo đứng hình và đen của bài đo 067a không được export. Đo lại trong `composeBridge.probeFreezeBlack` với cùng cờ ffmpeg, vì thư mục compose không được sửa ở task này.
- Chế độ chất lượng không gọi AI. Không có `llmDirector` để gọi.
