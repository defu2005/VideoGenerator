# Kế hoạch khắc phục để sản xuất video hàng loạt bằng agent (2026-11-16)

Nguồn: đánh giá kiến trúc ngày 2026-11-16, [RESEARCH-076](../research/auto-video-projects/RESEARCH-076.md) và PROPOSAL-STORAGE-004 (`PROPOSALS_AND_BUGS.md` #18).
Nhánh "node chạy cả dây chuyền" (TASK-135b/c) đã **dừng**. Kế hoạch này thay thế nhánh đó.

## Quyết định của người dùng (2026-11-16)

**Từ giờ LLM được phân phối qua API key OmniRoute của máy chủ.** Cụ thể:

- Mọi lời gọi LLM, dù từ pipeline trên máy chủ, Hermes, scout, operator hay worker node, đều đi qua **một** OmniRoute trên máy chủ.
- Không phát key của từng nhà cung cấp LLM (Anthropic, Gemini, OpenAI…) ra máy khác nữa.
- Máy khác gọi relay của máy chủ bằng khoá của chính máy đó (khoá máy agent hoặc token node). Máy chủ gắn key OmniRoute vào rồi chuyển tiếp lời gọi.
- Máy chủ kiểm ngân sách, giới hạn tốc độ, model được phép, ghi usage theo máy và theo job.

Hệ quả:
- Thêm máy không còn cần cài hay đăng nhập CLI LLM.
- Quota tập trung một chỗ, nên điều phối và đo đạc được.
- Rủi ro lộ key giảm, vì key không rời máy chủ.

## Điểm yếu → việc khắc phục

| # | Điểm yếu (đánh giá 2026-11-16) | Khắc phục | Task |
|---|---|---|---|
| 1 | LLM chỉ chạy được trên máy chủ; máy khác phải có key riêng hoặc CLI đã đăng nhập; Hermes nhận `VG_HERMES_MODEL_KEY` tay | Relay LLM OpenAI-compatible trên máy chủ, đi qua OmniRoute; khoá theo máy; ngân sách, giới hạn tốc độ, usage theo máy và job; bundle Hermes trỏ vào relay | **[TASK-136](TASK-136.md)** |
| 2 | Mọi tệp nằm trong `DATA_DIR` máy chủ; worker tải lên/tải xuống qua máy chủ | `StorageProvider` (local / S3-R2), URL ký sẵn, worker truyền trực tiếp, lùi về máy chủ khi lỗi | **[TASK-137](TASK-137.md)** |
| 3 | Không dọn rác: ổ đầy khi làm nhiều | Đếm tham chiếu theo SHA-256, xoá mềm `orphaned_at`, thời gian chờ, lưu trữ sau khi đăng | **[TASK-138](TASK-138.md)** |
| 4 | Agent phải chờ render đầy đủ mới biết hỏng | Xem trước nhanh: frame theo thời điểm, contact sheet từng cảnh, đoạn 3 giây độ phân giải thấp; có cache | **[TASK-139](TASK-139.md)** |
| 5 | Agent không thấy được video thành phẩm | `review_render` (contact sheet, loudness, khung đen/đứng, lệch phụ đề) | [TASK-090](TASK-090.md) (guide có sẵn) |
| 6 | Gate người duyệt là trần thông lượng; chưa có điểm chất lượng đo được để thay | Điểm chất lượng tổng hợp có giải thích; vòng critic → sửa có giới hạn lượt; tự duyệt gate khi đạt ngưỡng của kênh, còn lại chuyển người | **[TASK-140](TASK-140.md)** |
| 7 | Mỗi cảnh chọn riêng, video rời rạc | Director pass: kế hoạch liền mạch (nhân vật, màu, nhịp, motif) trước VISUAL_SEARCH, kiểm sau khi chọn | **[TASK-141](TASK-141.md)** |
| 8 | Chưa có event bus và "một lệnh → đăng → đo" | Mission control | [TASK-129a → 129c](TASK-129.md) (guide có sẵn) |
| 9 | Làm hàng loạt dễ thành cùng một khuôn (rủi ro "mass-produced"); không có lô; không có master → biến thể | Lô sản xuất: một lệnh ra N video trên nhiều kênh, phân bổ đa dạng recipe/style/hook, master render → biến thể khung/ngôn ngữ, giới hạn theo quota | **[TASK-142](TASK-142.md)** |
| 10 | Máy chủ là điểm chết duy nhất; SQLite một tiến trình ghi; đóng gói chưa từng chạy trên máy thứ hai | Đo tranh chấp ghi, gom ghi nóng, diễn tập khôi phục Litestream, kiểm khi khởi động; chạy thật trên máy thứ hai theo checklist | **[TASK-143](TASK-143.md)** |
| 11 | Nhân vật/thương hiệu không đồng nhất giữa các video | Bộ nhận diện + người dẫn | [TASK-098a](TASK-098a.md) (guide có sẵn) |
| 12 | Short chỉ cắt từ video dài | Short viết riêng + phễu | [TASK-103](TASK-103.md) (guide có sẵn) |

Những gì **không** làm, theo RESEARCH-076:
- Một tiến trình chạy cả pipeline trên node.
- Gửi mọi secret ra worker.
- Thêm provider chỉ để có nhiều.
- Dùng LLM thay cho kiểm tra cơ học.
- Tự đăng mà không có gate.

## Thứ tự chạy

| Đợt | Task | Song song được | Ghi chú |
|---|---|---|---|
| S0 | Review 128b, 134, 135a (Claude) | — | Giữ 134 và 135a; code 135b dở chờ người dùng quyết |
| S1 | **136** | 139 | 136 có migration. 139 không migration, không sửa file của 136 |
| S2 | **137** → **138** | 090 sau 137 (090 có migration: xếp sau 138) | 137 và 138 mỗi task một migration, đi lần lượt |
| S3 | **090** → **140** | 141 (không migration) | 140 đọc kết quả 090, 121, 066, 077, 113 |
| S4 | **129a → 129c** | 143 (không migration) | 143 chạy được bất cứ lúc nào sau 137 |
| S5 | **142** | 098a, 103 | 142 cần 129c và 140 |

Mỗi đợt chỉ một task có migration chạy cùng lúc (README quy tắc chung).
