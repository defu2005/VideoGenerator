# Kho tri thức bên ngoài

Mỗi entry có nguồn và ngày kiểm. Resolver xét snapshot, phiên bản đã duyệt và thiết lập người dùng. `validFrom` bao gồm ngày bắt đầu, `validUntil` loại trừ ngày kết thúc. Freshness tính khi đọc và không lưu vào DB. Phiên bản của tri thức đã đọc được ghi qua `project.settings.knowledgeRev`.

## Thêm loại tri thức

1. Viết schema Zod cho `value` và thêm loại vào `KNOWLEDGE_VALUES`.
2. Thêm tệp JSON theo loại vào `packages/shared/src/knowledge/snapshot/` và đăng ký ở loader. Dùng mảng rỗng nếu chưa có dữ liệu đã review.
3. Cập nhật `CHANGE_CATEGORIES`, tài liệu [danh mục](change-catalog.md) và bảng nơi dùng `consumers.ts`. Ghi detector hoặc lý do kiểm thủ công và quy tắc rủi ro.
4. Viết kiểm thử parse, phạm vi và rủi ro, kiểm cả chỗ đọc resolver. Ghi giả định dời khỏi code vào [bản rà soát](assumptions.md).

## Nhập và duyệt

Nhập mảng entry, hoặc mảng market theo RESEARCH-071. Loại cũ `platform_limit` được chuyển thành `platform_capability`. Việc đọc tệp và duyệt do người dùng thực hiện. Import không tự tải URL. Auto-apply mức thấp chỉ kiểm câu trích bằng bản sao trang đã xác minh của provider intel. Mức vừa mặc định tắt qua khóa `knowledge.autoApplyMedium`. Khi bật, các loại mức cao vẫn cần duyệt. Thiết lập riêng theo hồ sơ và ngữ cảnh RAG không nằm trong bảng này.
