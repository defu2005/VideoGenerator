# TASK-071 — Thị trường mục tiêu

## Thay đổi

| Tệp | Nội dung |
|---|---|
| `packages/shared/src/markets/{schema,index}.ts`, `packages/shared/src/knowledge/{schema,consumers}.ts`, `packages/shared/src/index.ts` | Schema MarketPack, danh sách, locale, mặc định theo nền tảng và ngày sự kiện. Thị trường mới đã duyệt được đọc qua kho tri thức. |
| `packages/shared/src/schemas/{profile,project,publication}.ts`, `apps/server/src/db/schema.ts`, `apps/server/drizzle/0061_profile_market.sql` và metadata | Trường market cho hồ sơ và dự án mới, cảnh báo tài khoản và migration Drizzle. |
| `apps/server/src/knowledge/markets.ts`, `apps/server/src/services/{profileService,projectService}.ts`, `apps/server/src/api/profiles.ts` | Đọc dữ kiện đã duyệt, xem trước và áp dụng từng trường trong giao dịch, đánh dấu thao tác của người dùng và giữ các mục đã sửa thủ công trong 30 ngày dưới dạng bỏ tích mặc định. |
| `packages/shared/src/guidelines/{schema,resolve}.ts`, `apps/server/src/guidelines/service.ts`, `apps/server/src/retrieval/indexer.ts` | Quy tắc quốc gia nằm giữa pack nền tảng và pack kênh. Pack người dùng thắng khi cùng ID. |
| `apps/server/src/stages/script/{prompt,mergedStoryPrompt,scriptUtils}.ts`, `apps/server/src/services/topicService.ts` | Quốc gia và yêu cầu bản địa hóa vào prompt kịch bản và hash. Gợi ý chủ đề nhận tối đa tám sự kiện trong 45 ngày. |
| `apps/server/src/{lib/defaultVoice,api/voice,stages/voice/voiceExecutor}.ts`, `apps/server/src/{api/connections,publishing/publishService}.ts` | Ưu tiên locale khi chọn giọng tự động và hiển thị cảnh báo nền tảng theo thị trường. |
| `apps/server/src/assistant/{loop,tools}.ts`, `apps/server/src/settings/notifications.ts`, `apps/server/src/registry/invoke.ts` | Múi giờ của người dùng cho trợ lý và các công cụ báo cáo. Registry dùng chung có `get_market_pack` và nhận market trong công cụ sửa định hướng với mức confirm. |
| `apps/web/src/features/profiles/{MarketSettings,ProfileListPage,ProfileDetailPage}.tsx`, `apps/web/src/features/accounts/AddAccountWizard.tsx` | Picker tìm theo tên hoặc mã, xem dữ kiện và freshness, hộp thoại chọn mặc định, lọc ngôn ngữ khi tạo hồ sơ và cảnh báo kết nối. |
| `packages/shared/src/features/featureMap.ts`, `docs/user-guide/{ho-so,nhat-ky-thay-doi}.md` | Tài liệu thao tác, phạm vi của hai múi giờ và cách bổ sung thị trường. |
| `packages/shared/test/markets.test.ts`, `apps/server/test/profiles.test.ts` và fixture web theo schema hồ sơ | Test schema, mặc định, ngày, pack, API, giọng, prompt, múi giờ và tri thức đã duyệt. Năm fixture web thêm `market: null` theo kiểu mới. |

## Quyết định và dữ kiện cần rà soát

- Browser gửi `previewToken` tùy chọn để server phát hiện khi dữ kiện hoặc cài đặt đã đổi sau lúc xem trước. Client cũ vẫn có thể gửi `{ code, fields }`.
- App lấy giờ đăng từ tài khoản được chọn cho lịch. Hồ sơ chưa có tài khoản dùng nền tảng trong brief, nếu có dữ kiện. App giữ giờ hiện tại khi nguồn để trống.
- Snapshot có 17 mục và khớp checksum SHA-256 trước và sau triển khai. Mọi sự kiện hiện ghi ngày cụ thể trong năm 2026 và chỉ xuất hiện khi ngày đó nằm trong cửa sổ gợi ý. Hàm cũng xử lý tháng/ngày hằng năm và thứ trong tháng khi dữ kiện có quy tắc lặp. Cần nhập ngày đã xác minh cho các năm sau hoặc quy tắc lặp có nguồn.
- Có thể phân loại lại từng nguồn chính phủ, cơ quan quản lý và tài liệu nền tảng thành `official` nếu URL trực tiếp chứng minh dữ kiện tương ứng. Nguồn thống kê ngành phù hợp với `industry`. Dữ kiện tổng hợp và suy luận giữ `inference`. Loại bằng chứng của snapshot được giữ theo kết quả review trước triển khai.

## Kiểm chứng

- `npm run typecheck` và `npm run build` đạt cả bốn workspace. Vite báo cảnh báo annotation trong Zod và kích thước chunk chính.
- `npm test --workspaces --if-present -- --maxWorkers=4 --testTimeout=60000 --hookTimeout=60000` đạt 510 test shared, 19 MCP, 877 server và 180 web. Server có 3 test skip. Lượt đầu trùng thời điểm TASK-067b cập nhật test compose. Lượt cuối chạy toàn bộ và đạt.
- Lượt cuối của `npx --no-install drizzle-kit generate` trong `apps/server` trả về “No schema changes”.
- Chromium trên cổng 5180 với SQLite tạm xác nhận chọn và áp dụng GB trên hồ sơ thử, lưu `Europe/London`, giờ `15:00` và `23:00`, vùng xu hướng `GB`. Trình tạo hồ sơ hiển thị tiếng Anh theo thị trường và lưu `fr` qua lựa chọn **Khác**.
- Kiểm tra UTF-8, NUL và `git diff --check` trên các tệp triển khai.
