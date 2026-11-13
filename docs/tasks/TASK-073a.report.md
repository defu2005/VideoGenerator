# TASK-073a — Kho tri thức bên ngoài

## Đã triển khai

- Danh mục 32 nhóm thay đổi, gồm B6, B7, B8, D4, E5 và G2, kèm detector dự kiến, phương án kiểm thủ công, mức phản ứng và test đối chiếu contract.
- Mười schema và tệp snapshot. Resolver chọn bản theo ID, lớp, ngày hiệu lực và ngày hết hiệu lực, tính freshness khi đọc và trả về revision. Bộ guideline sẵn có chuyển nguyên nội dung vào snapshot. Bản được duyệt có hiệu lực trong guideline đang dùng. Thiết lập và pack riêng của người dùng vẫn được ưu tiên.
- Migration `0060_knowledge_073a` tạo bảng entry, proposal và revision. Duyệt ghi phiên bản trong một giao dịch SQLite. Khôi phục thêm phiên bản. Import trả kết quả từng dòng, hỗ trợ đổi kind cũ `platform_limit`, và chỉ làm mới ngày kiểm khi dữ liệu giống nhau.
- Assistant, MCP và operator dùng registry chung. Hai tool ghi cần xác nhận. Người dùng duyệt, bỏ qua hoặc khôi phục từ Cài đặt → Tri thức. Auto-apply mức thấp kiểm câu trích trong bản lưu provider intel. Mức vừa mặc định tắt.
- Di chuyển giới hạn và metadata YouTube, caption Direct Post TikTok, scope analytics và hợp đồng quota sang snapshot. App ghi hash ngắn của dữ kiện đã dùng vào `project.settings.knowledgeRev`. Cập nhật feature map, user guide, nhật ký thay đổi và trang đăng bài.

## Quyết định về dữ liệu

- Snapshot chỉ giữ các guideline đã có và các entry thay giả định đã di chuyển. Bộ parser kiểm được 125 mục monetization, 17 thị trường và 111 mục change-signals. Việc nhập trọn bộ dành cho lượt review riêng.
- `youtube.data.videos_insert` giữ trường `quotaCost: 100` theo contract và export tương thích. Bộ đếm vận hành đọc `quota.cost: 1` và quota riêng cho mỗi phương thức `videos.insert` và `search.list`. App vẫn gửi `privacyStatus` theo lựa chọn. [YouTube quota](https://developers.google.com/youtube/data/determine_quota_cost) · [YouTube revision history](https://developers.google.com/youtube/data/revision_history)
- Các ngưỡng tương thích chưa đối chiếu được theo endpoint Meta và dữ kiện quyền sử dụng theo từng asset được ghi trong [bản rà soát giả định](../knowledge/assumptions.md).
- Một fixture của test autonomy gate đã đổi từ ngày UTC sang ngày theo giờ Việt Nam, cùng cách tính với app. Logic gate giữ nguyên.

## Kiểm chứng

- `npm run typecheck` và `npm run build` đạt cả bốn workspace. Vite báo cảnh báo về annotation trong dependency Zod và kích thước chunk chính.
- `npm test --workspaces --if-present -- --maxWorkers=4 --testTimeout=60000 --hookTimeout=60000` đạt 505 test shared, 19 MCP, 847 server và 180 web. Server có 3 test skip.
- Kiểm tra import trực tiếp trên cả ba nguồn research đạt 253/253 mục hợp lệ.
- Chạy lại `npx --no-install drizzle-kit generate` trong `apps/server` trả về “No schema changes”.
- Chromium ở cổng 5180, API và SQLite riêng trong thư mục tạm. Nhập hai entry, tự áp dụng mục rủi ro thấp, duyệt mục rủi ro cao rồi khôi phục. Lịch sử ghi bản 1 và bản 2, tab Lịch sử tìm lại được mục đã sửa. Browser và API fixture chặn truy cập dịch vụ ngoài máy.
