---
name: video-bao-cao-thu-nghiem
description: >-
  Ghi báo cáo cho mỗi lần chạy một skill vận hành kênh trong app Video Agent:
  đã làm gì, vì sao, giả thuyết, chỉ số để kiểm và ngày kiểm; sau đó kiểm
  chứng kết quả và đề xuất cải tiến skill. Dùng sau mọi skill video-*, khi
  người dùng hỏi hướng nào hiệu quả, hoặc khi nhiều agent ở nhiều môi trường
  cùng vận hành một kênh.
operator: true
area: kenh
triggers:
  - báo cáo thử nghiệm
  - bao cao thu nghiem
  - kiểm chứng
  - kiem chung
  - hướng nào hiệu quả
  - cải tiến skill
  - agent nào đã làm
antiTriggers:
  - xoá
  - xoa
tools:
  - list_publications
  - video_metrics
  - analytics_overview
  - profile_insights
  - get_agent_context
  - claim_skill_run
  - save_skill_report
  - complete_skill_report
  - list_skill_reports
  - import_skill_reports
risk: read
---

# Báo cáo, kiểm chứng và cải tiến

Mọi hướng triển khai kênh phải để lại báo cáo. Không có báo cáo thì không biết hướng nào đúng, và agent sau (có thể ở môi trường khác, loại khác) sẽ lặp lại sai lầm cũ.

## Ba bước bắt buộc với mọi skill `video-*`

1. **Trước khi làm: đọc báo cáo cũ và nhận việc.**
   - `list_skill_reports` cho cùng hồ sơ và cùng skill (30 ngày gần nhất). Đọc giả thuyết nào đã sai để không thử lại y hệt.
   - `claim_skill_run` cho hồ sơ + skill. Nếu agent khác đang giữ việc này → dừng, báo người dùng tên agent và môi trường đang giữ. Không làm song song.
2. **Sau khi làm: lưu báo cáo** bằng `save_skill_report` (mẫu bên dưới). Lưu cả khi thất bại hoặc bị chặn.
3. **Đến ngày kiểm: kiểm chứng** bằng `list_skill_reports` với `due: true`, lấy số thật (`video_metrics`, `analytics_overview`, `list_publications`), rồi `complete_skill_report` với kết quả và kết luận.

Nếu môi trường của bạn chưa có các tool `*_skill_report` / `claim_skill_run`, xem mục "Khi không có tool báo cáo".

## Mẫu báo cáo

```yaml
skill: video-lich-san-xuat          # tên skill đã chạy
skillHash: <8 ký tự hex đầu của sha256 SKILL.md đã đọc, sau khi đổi CRLF thành LF; read_skill trả sẵn>
profileId: <id hồ sơ>
profileName: <tên hồ sơ>
subjects:                           # video hoặc chủ đề mà chỉ số đo trên đó
  projectIds: []
  publicationIds: []
  topicIds: []
agent:
  kind: operator | hermes | codex | cursor | claude | khac
  name: <tên agent người dùng đặt>
  model: <model nếu biết>
environment: <tên môi trường, ví dụ may-nha, vps-1, cloud>
startedAt: <ISO time>
inputs: <đã đọc gì: tool và số liệu chính, ngắn>
decision: <quyết định chính và lý do>
actions:                            # tool đã gọi có thay đổi dữ liệu
  - tool: set_profile_automation
    result: pending_action | done | blocked
    ref: <id pending action / project / publication>
hypothesis: <"Làm X thì chỉ số Y thay đổi Z">
metrics:                            # chỉ số để kiểm, phải là số app có
  - name: retention_30s
    baseline: <số hiện tại, hoặc null nếu chưa có>
    target: <số mong đợi>
checkAt: <ngày kiểm, ISO date>
status: done | partial | blocked | failed
notes: <điều bất thường, việc người dùng phải làm>
```

Quy tắc:
- `hypothesis` và `metrics` bắt buộc. Việc chỉ đọc (báo cáo số liệu) thì giả thuyết là "đề xuất A sẽ giúp B" và mốc kiểm là lần báo cáo sau.
- `baseline` lấy số thật. Thiếu số thì ghi `null`, không đoán.
- Không ghi key, token, email, mật khẩu, đường dẫn file bí mật vào báo cáo.
- Báo cáo bằng tiếng Việt, ngắn. Một báo cáo cho một lần chạy.

## Kiểm chứng

- Video đăng chưa đủ 48 giờ thì chưa kết luận; dời `checkAt`.
- Kết luận một trong ba: `dung` (đạt mục tiêu), `sai` (không đạt), `chua_ro` (mẫu nhỏ, dưới 3 video, hoặc thiếu số).
- Ghi số thật bên cạnh `baseline` và `target`. Không làm tròn cho đẹp.
- Ghi bài học một câu: lần sau làm gì khác.

## Cải tiến skill

- `list_skill_reports` theo skill (90 ngày). Nếu từ 3 báo cáo trở lên cùng một skill kết luận `sai` vì cùng một lý do → viết đề xuất sửa skill: đoạn nào, sửa thành gì, dựa trên báo cáo nào (id).
- Lưu đề xuất bằng `save_skill_report` với `status: proposal`, hoặc báo người dùng. **Không tự sửa file `SKILL.md`**; người dùng sửa.
- So sánh giữa các agent và môi trường chỉ khi cùng skill, cùng hồ sơ hoặc hồ sơ cùng ngách, và cùng `skillHash`. Khác phiên bản skill thì so như hai thử nghiệm khác nhau.

## Nhiều môi trường, nhiều loại agent

- Luôn điền `agent.kind`, `agent.name`, `environment`. Lấy từ biến môi trường `VG_AGENT_KIND`, `VG_AGENT_NAME`, `VG_ENVIRONMENT` nếu có; không có thì hỏi người dùng một lần và ghi lại.
- Mỗi môi trường có thể nối tới một app khác nhau. Trước khi làm, xác nhận app đang nối (`get_agent_context` cho biết tên môi trường của app, hồ sơ có những gì). Hồ sơ không có trong app này → dừng, không tạo hồ sơ mới thay.
- Agent chỉ đọc được file (không có MCP) vẫn phải báo cáo: dùng cách bên dưới.
- Hai agent cùng muốn làm một việc: `claim_skill_run` quyết định. Khoá hết hạn sau 2 giờ nếu agent không báo xong.

## Khi không có tool báo cáo

Ghi đúng các trường của mẫu trên dưới dạng JSON (một object, cùng tên trường) vào thư mục báo cáo của môi trường:

```
reports/skill-runs/<YYYY-MM-DD>-<skill>-<profileId 8 ký tự>-<agent.name>.json
```

Thêm trường `profileName` (tên hồ sơ) vì môi trường khác có thể dùng app khác, id hồ sơ khác.

Báo người dùng đường dẫn file. Người dùng (hoặc agent có tool) nạp vào app bằng `import_skill_reports`. Không ghi đè file cũ; chạy lại thì thêm `-2`, `-3`.

## Không làm

- Không bỏ qua báo cáo vì "việc nhỏ".
- Không sửa hay xoá báo cáo của agent khác; chỉ thêm kết quả kiểm chứng vào báo cáo đến hạn.
- Không kết luận hướng kênh từ một báo cáo.
- Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.
