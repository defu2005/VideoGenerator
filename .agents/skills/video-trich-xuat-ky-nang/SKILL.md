---
name: video-trich-xuat-ky-nang
description: >-
  Quy trình rút một kỹ năng mới từ việc vừa làm xong và gửi đi dưới dạng bản
  nháp bằng propose_skill. Dùng sau khi hoàn thành một việc lặp lại, hoặc khi
  nhận ra mình đang làm đi làm lại cùng một chuỗi bước.
operator: true
area: tu-van-hanh
triggers:
  - lưu cách làm
  - luu cach lam
  - trích xuất kỹ năng
  - đề xuất skill
  - viết skill mới
  - propose skill
tools:
  - find_skills
  - read_skill
  - propose_skill
  - get_agent_context
  - list_skill_reports
  - search_user_guide
risk: safe
---

# Trích xuất kỹ năng

## Khi nào dùng

Bạn vừa làm xong một việc có từ 3 bước trở lên, đã làm thành công và có khả năng lặp lại; hoặc đã vấp cùng một lỗi nhiều lần và tìm ra cách sửa.

## Các bước

1. `find_skills` với từ khóa của việc. Đã có skill phủ việc này thì đọc bằng `read_skill`; chỉ đề xuất bản mới khi bổ sung được điều thật sự thiếu.
2. Ghi lại thứ tự bước thật đã chạy, tool đã dùng, mã lỗi gặp và cách xử lý. Không viết điều chưa thử.
3. Soạn markdown theo khuôn: frontmatter (`name` bắt đầu bằng `video-`, `description`, `operator: true`, `area`, `triggers`, `tools`, `risk`) và các mục **Khi nào dùng**, **Các bước**, **Kiểm tra kết quả**, **Lỗi hay gặp**, **Không được làm**.
4. `tools` chỉ liệt kê tên có trong kho tool của app. `risk` phải bằng hoặc cao hơn tool rủi ro nhất (tool `confirm` thì `risk: confirm`).
5. Gọi `propose_skill` với `markdown` (tối đa 12000 ký tự), `reason` (một hai câu vì sao đáng lưu, tối đa 500 ký tự) và `basedOn` (mã các lần chạy làm cơ sở).
6. Kết quả luôn là bản nháp `{name, version, status: "draft"}`. Báo người dùng bản nháp nằm ở Vận hành > Kỹ năng; chỉ họ kích hoạt sau khi chấm điểm.

## Kiểm tra kết quả

- Nhận được `name`, `version` và `status: "draft"`.
- Bản nháp hiện trong trang Kỹ năng với nguồn "agent_proposal".

## Lỗi hay gặp

- `INVALID_OPERATOR_SKILL`: markdown sai khuôn, thiếu mục, tool không có trong kho hoặc `risk` thấp hơn cần.
- `BUILT_IN_SKILL`: trùng tên skill dựng sẵn; đổi tên.
- `SKILL_DRAFT_LIMIT`: đã đủ số bản nháp trong ngày; đợi sang ngày hoặc gộp ý.
- Tên không bắt đầu bằng `video-` bị từ chối.

## Không được làm

- Không đưa khóa, token, email hay id dự án được bảo vệ vào nội dung skill.
- Không tự kích hoạt skill hay sửa thẳng thư mục `.agents/skills`; xuất ra file là việc của người dùng (`npm run export-skills`).
- Không đề xuất skill khi chưa làm thật việc đó.
- Không viết skill dài dòng; mỗi skill một việc.
