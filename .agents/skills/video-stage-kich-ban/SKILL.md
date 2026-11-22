---
name: video-stage-kich-ban
description: >-
  Vận hành riêng bước SCRIPT: đọc dàn ý, hook và điểm critique từ Story Engine,
  đọc điểm chất lượng, ghi chú review và ghi chú [lint], nhận biết kịch bản nhạt
  (liệt kê ngày tháng, sáo rỗng, outro mẫu), đổi hook, chấm lại điểm, rồi chọn
  giữa sửa tự động, chạy lại và báo người dùng.
operator: true
area: du-an-va-quy-trinh
triggers:
  - kịch bản
  - kich ban
  - script
  - kịch bản nhạt
  - kịch bản nhàm
  - story engine
  - outline
  - hook
  - đổi hook
  - switch hook
  - critique
  - chấm điểm kịch bản
  - rescore
  - lint
  - quality_score
  - blocking_facts
antiTriggers:
  - thumbnail
  - phụ đề
tools:
  - get_project
  - get_pipeline
  - get_events
  - run_pipeline
  - repair_script
  - get_script_draft
  - switch_script_hook
  - rescore_script
  - get_profile
  - search_lessons
  - record_lesson
risk: confirm
---

# Bước SCRIPT

## Khi nào dùng

- SCRIPT lỗi hoặc chạy quá giờ.
- SCRIPT bị giữ vì điểm chất lượng thấp hoặc vì có `blocking_facts`.
- Người dùng chê kịch bản nhạt, chỉ đọc lại thông tin, hoặc muốn mở đầu hấp dẫn hơn.
- Cần đọc dàn ý, đánh giá 3 hook ứng viên hoặc điểm critique từ Story Engine.
- Muốn đổi câu mở đầu sang một hook khác đã được tạo sẵn bằng `switch_script_hook`.
- Người dùng vừa sửa tay kịch bản và muốn chấm lại điểm bằng `rescore_script`.

**Bước SCRIPT có thể do agent ngoài viết.** Khi dự án giao SCRIPT cho agent, bản nháp mới có `author = agent:<instance>` trong `script_drafts`. Đọc `author` qua `get_script_draft`: giá trị bắt đầu bằng `agent:` nghĩa là agent đã viết bản gần nhất; trống nghĩa là app viết. Lưu ý: app chưa xóa `author` khi chạy lại SCRIPT, nên giá trị `agent:` có thể còn sau một lần app sửa. Khi báo người dùng, nói rõ ai viết nếu có thể kiểm chắc; không được coi `author` là bằng chứng bản đó đã qua cổng.

## Bước này nhận gì, ra gì

- **Nhận:**
  - ghi chú RESEARCH;
  - recipe định dạng: mục đích từng phần và kiểu hook;
  - hướng kênh và ghi chú đã học của kênh;
  - guideline của nền tảng.
- **Ra:**
  - `title`, `hook`, các `sections` (lời đọc, truy vấn ảnh, mood nhạc) và `outro`;
  - `quality_score`, từ 0 đến 10;
  - `review_notes`, tối đa 8 ghi chú. Ghi chú bắt đầu bằng `[lint]` do bộ kiểm văn phong bằng code tạo ra;
  - `blocking_facts`: các ý cần xác minh trước khi đi tiếp;
  - **Bản nháp Story Draft** (ở BALANCED/QUALITY/MAX): khung tự sự, câu hỏi trung tâm, lời hứa, các beats, 3 ứng viên hook kèm điểm số, và bản chấm điểm critique 6 tiêu chí (thang 100).

## Đọc dàn ý và điểm giám khảo (Story Engine)

Gọi `get_script_draft` với `projectId` để đọc:
1. **Dàn ý (`outline`):** khung tự sự (`framework`), câu hỏi mở đầu (`centralQuestion`), lời hứa (`promise`), danh sách beat (`beats`) và các vòng tò mò (`loops`).
2. **Ứng viên câu mở đầu (`hookCandidates` & `hookAssessments`):**
   - 3 lựa chọn với chiến thuật khác nhau (`question`, `bold_claim`, `cold_open`, `curiosity_gap`...).
   - Điểm số từng tiêu chí (tò mò, rõ ràng, chính xác, hợp khán giả, lời hứa).
   - Hook hiện tại (`chosenHookId`).
3. **Bản chấm điểm giám khảo (`critique`):**
   - Tổng điểm trên thang 100 (`total`).
   - 6 tiêu chí: cấu trúc (`structure`), mở đầu (`hook`), độ chính xác (`accuracy`), đọc tự nhiên (`ttsNatural`), dễ hình dung (`visualizable`), tính độc đáo (`originality`).
   - Cờ cảnh báo: `hookPaidOff` (kết bài có đền đáp lời hứa mở đầu không) và `unclosedLoops` (danh sách vòng tò mò chưa được đóng).
   - Danh sách lỗi từng phần (`sectionIssues`) kèm gợi ý sửa.
4. **Dàn ý chờ duyệt (TASK-146):** khi dự án có `scriptOutlineApproval = outline` và bản nháp ở `phase = outline_ready`, dàn ý đang chờ người dùng duyệt trên tab Script. Đọc để tóm tắt cho người dùng; không tự đề xuất sửa beat, câu hỏi trung tâm hay hook thay họ. Việc duyệt là của người dùng.

## Đọc ghi chú [lint]

| Mã | Nghĩa | Cách xử lý |
|---|---|---|
| `DATE_LIST` | Một phần kể như liệt kê năm tháng | Sửa: kể qua một cảnh, một người hoặc một quyết định |
| `CLICHE` | Cụm sáo rỗng như "hành trình", "bi tráng" | Sửa nếu xuất hiện nhiều lần |
| `TEMPLATE_OUTRO` | Outro chỉ cảm ơn hoặc kêu đăng ký | Sửa: outro phải trả lời câu hỏi của hook |
| `HOOK_REPEATED` | Câu hook bị lặp lại ở phần 1 | Sửa |
| `FLAT_RHYTHM` | Các câu dài đều nhau nên đọc đơn điệu | Nên sửa |
| `NO_QUESTION_PAYOFF` | Hook hỏi nhưng outro không trả lời (chỉ là ước lượng) | Tự đọc lại để kiểm tra |
| `LONG_SENTENCE` | Câu dài hơn giới hạn của recipe | Sửa nếu giọng đọc bị vấp |

## Các bước xử lý

1. Gọi `search_lessons` với "kịch bản" và loại recipe. Gọi `get_profile` để biết hướng kênh.
2. Gọi `get_project` để đọc kịch bản, `quality_score`, `review_notes` và `blocking_facts`.
3. Gọi `get_script_draft` nếu dự án có bản nháp Story Engine.
4. **Chọn cách xử lý:**
   - **Muốn đổi cách mở đầu:** Nếu người dùng muốn hook khác hoặc hook hiện tại điểm tò mò thấp, đề xuất `switch_script_hook` với một trong các `hookCandidates` còn lại. Thao tác này tự động viết lại phần 1 cho ăn khớp mà không mất các phần sau.
   - **Người dùng đã sửa tay kịch bản:** Đề xuất `rescore_script` để cập nhật bảng điểm critique và kiểm tra xem có vòng lặp nào bị vỡ không.
   - **Có `blocking_facts`:** không tự sửa sự thật. Báo người dùng các ý cần xác minh.
   - **Điểm thấp hoặc nhiều ghi chú `[lint]` cần sửa:** gọi `repair_script` (có rủi ro `confirm`, tạo việc chờ duyệt).
   - **Đã sửa hai lần mà vẫn kém:** kiểm tra RESEARCH bằng skill `video-stage-nghien-cuu`. Nghiên cứu nghèo thì sửa kịch bản cũng không cứu được.
   - **Lỗi định dạng hoặc lỗi model:** gọi `run_pipeline` với `stage: SCRIPT` một lần. Nếu vẫn lỗi, xem skill `video-mo-hinh-ai`.
5. **Khi nào phải chuyển tiếp cho người dùng (Escalate):**
   - Điểm chính xác `accuracy` < 3 hoặc có `blocking_facts`: có nguy cơ sai sự thật nghiêm trọng, dừng lại báo người dùng xác nhận thông tin.
   - `hookPaidOff` là `false` sau khi đã sửa: kịch bản mở đầu một đằng kết một nẻo, cần người dùng duyệt hoặc sửa tay kết bài.
   - Người dùng đã sửa tay kịch bản (nguồn USER): không ghi đè, chỉ đề xuất.
6. **Trước khi đề xuất chạy lại SCRIPT**, nói rõ hậu quả: mọi bước sau (cảnh, ảnh, giọng, nhạc, timeline) thành cũ, và phải làm lại các bước đó.
7. **Khi một kiểu lỗi lặp lại** ở cùng kênh hoặc cùng recipe, gọi `record_lesson`.

## Kiểm tra kết quả

- `quality_score` tăng lên.
- Ghi chú `[lint]` mức sửa đã hết.
- `blocking_facts` rỗng, hoặc người dùng đã xác nhận các ý đó.

## Lỗi hay gặp

| Mã | Ý nghĩa | Cách xử lý |
|---|---|---|
| `SCRIPT_MISSING` | Bước sau cần kịch bản mà chưa có | Chạy SCRIPT trước |
| `LLM_INVALID_OUTPUT` | Model trả sai định dạng | Chạy lại một lần |
| `LLM_UNAVAILABLE` | Không gọi được model nào | Xem `get_llm_health` qua skill `video-mo-hinh-ai` |
| `LLM_LIMIT_TOO_SMALL` | Giới hạn token quá nhỏ cho độ dài video | Báo người dùng chỉnh giới hạn |
| `AUTONOMY_BUDGET_WAIT` | Hết ngân sách tự động trong kỳ | Chờ, hoặc để người dùng nâng ngân sách |

## Không được làm

- Không bịa trích dẫn, số liệu hay sự kiện để kịch bản hấp dẫn hơn.
- Không duyệt gate và không chạy bước nào trên dự án được bảo vệ.
