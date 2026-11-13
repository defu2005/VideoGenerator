# TASK-073b — Hộp thay đổi, chính sách phản ứng, detector D1/D2/D6/D7

## Đã triển khai

- Bảng `change_events`, `change_holds` và `change_signal_hits` qua migration `0062_condemned_la_nuit`. Sự kiện trùng fingerprint đang mở được gộp: tăng số lần thấy và giờ thấy cuối, không thêm dòng mới.
- Chính sách phản ứng theo nhóm và mức. Thông tin là R0, cảnh báo là R2 hoặc R3 nếu nhóm đã có phương án cấu hình, cao là R2 kèm R1, nghiêm trọng là R4 kèm R1. Một sự kiện tài khoản mức nghiêm trọng không hạ được dưới R4. R3 chỉ nhận phương án đã cấu hình, không đụng MUST, không vượt ngân sách và không bật paid fallback. R4 giữ đúng consumer đọc dữ kiện đó. Đăng YouTube bị giữ không chặn TikTok. Nút Tiếp tục và Đóng đều nhấc giữ của sự kiện.
- D1 đọc trang qua fetch giả lập trong test: bỏ ngày và số đếm trước khi hash, RSS chỉ lấy mục mới, 404 hoặc đổi đường dẫn là G1, thân trang rỗng hoặc canonical đổi là G2, robots hoặc 403 thành việc đối chiếu tay. Câu trích không có trên trang thì độ tin cậy thấp và không tạo đề xuất. ECO hoặc hết ngân sách (mặc định 20 lượt đọc mỗi ngày) chỉ lưu hash.
- D2 gắn vào HTTP ảnh, footage, LLM, lỗi token YouTube/TikTok và từ chối bản quyền YouTube. Sunset hoặc lỗi xác thực ghi ngay. Mã 429 cần đủ ngưỡng. Một lỗi 500 không tạo sự kiện. CLI đổi phiên bản sau lần đã thấy cũng tạo sự kiện. Thay đổi provider intel vẫn ghi bảng cũ và thêm một sự kiện.
- D6 liệt kê mục cũ rủi ro cao thành sự kiện mức cao. `npm outdated --json` và `npm audit --json` chỉ được đọc. Lời khuyên mức cao và gói bị đánh dấu cũ thành sự kiện nhóm D3. Không cài và không nâng gói.
- D7 là tool xác nhận `report_change`. Nếu nội dung nêu một ID tri thức thì mở điều tra R5. Đọc bằng `list_change_events`, đóng bằng `resolve_change_event`.
- Ba skill operator: `knowledge_refresh`, `change_investigation`, `research_brief`. Không có tool chấp nhận tri thức và không có tool nhấc giữ.
- Tab Thay đổi trên Cài đặt → Tri thức, lọc trạng thái và mức, liên kết đề xuất. Việc mức cao hoặc nghiêm trọng còn mở hiện ở Cần bạn xử lý. Bản tin ngày nhận các sự kiện R1. User guide, nhật ký và feature map đã cập nhật.

## Kiểm chứng

- `npm run typecheck` đạt cả bốn workspace, khoảng 12:28 giờ Việt Nam (UTC+7) ngày 11/11/2026.
- `npm test` cùng giờ: shared 550, MCP 19, web 181. Server trong lượt đầy đạt 894 và skip 3, rồi `connections.test.ts` hết giờ hook 30 giây vì máy đang chạy nhiều file. Chạy riêng file đó với hook 60 giây: 18/18 đạt. `changeEvents.test.ts` 8/8, gồm gộp fingerprint, từng detector có ca kích và ca không kích, giữ đúng tài khoản, và ngân sách đọc.
- Tab Thay đổi được kiểm bằng test giao diện: hiện tóm tắt, nút Tiếp tục, nút Đóng, liên kết đề xuất, và đổi bộ lọc mức thì gọi lại API. Không mở app trên cơ sở dữ liệu thật của máy.

## Ngoài phạm vi

- Chưa làm detector D3 và D4 của TASK-073c, cũng chưa làm 073d.
- Không commit và không push.
