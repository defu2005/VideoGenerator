# Giao việc cho Codex (dùng tiếp phiên desktop)

Phiên desktop: **Xây dựng app agent tự vận hành**
- id: `01a1be40-13b3-78c2-a75a-bf251639d41d`
- thư mục: `C:\Users\defu\Documents\videoGenerator`
- model: gpt-6.1-sol, mức suy luận medium

`codex queue` đưa tin nhắn vào hàng chờ của phiên này qua daemon mà bản desktop đang dùng. `--resume` cho phiên chạy luôn. Trả lời hiện trong app Codex desktop, giống như bạn tự gõ ở đó.

## Lệnh (PowerShell, chạy ở thư mục repo)

Thay `TASK-XXX` bằng số task, ví dụ `TASK-058`:

```powershell
$task = "TASK-XXX"
$msg = ((Get-Content docs\tasks\codex-dispatch.md -Raw -Encoding UTF8) -split "(?m)^=== PROMPT ===\r?$")[1].Trim().Replace("{TASK}", $task)
codex queue --thread 01a1be40-13b3-78c2-a75a-bf251639d41d --message $msg --resume
```

Không giao task mới khi phiên đang làm task khác, vì hai lượt sẽ sửa cùng file.

## Nội dung gửi đi

=== PROMPT ===
Làm {TASK} trong repo này.

1. Đọc AGENTS.md, docs/cursor/README.md (quy tắc, lệnh, checklist hoàn thành), rồi docs/cursor/{TASK}.md. Guide là spec, làm đủ.
2. Luật cứng:
   - Không commit, push hay đổi branch. Giữ nguyên các thay đổi chưa commit của task trước.
   - Không động vào .env, .claude/, data/, scripts/.
   - Không thêm hay nâng npm dependency, trừ khi guide cho phép.
   - Không viết tay migration: sửa apps/server/src/db/schema.ts rồi chạy `npx drizzle-kit generate` trong apps/server.
   - Test không dùng mạng, không gọi CLI LLM/TTS thật, không dùng key thật.
   - Không duyệt cổng hay render trên dự án 56374fb2-54cf-48ff-9441-2e6c653295d4.
   - Không ghi log hay trả secret ra ngoài.
3. Tự kiểm thử trước khi xong:
   - Chạy typecheck và build mọi workspace.
   - Chạy test shared, server, web, mcp. Số test không được giảm.
   - Chạy `npx drizzle-kit generate` trong apps/server, phải ra "No schema changes".
   - Test hỏng thì sửa nguyên nhân. Chỉ sửa test cũ khi đổi hành vi có chủ ý, và ghi rõ trong báo cáo.
4. Làm phần Done của guide: trang hướng dẫn người dùng, featureMap, changelog. Viết docs/tasks/{TASK}.report.md với các mục:
   - file đã đổi
   - chỗ làm khác guide và lý do
   - kết quả typecheck, build, test kèm số lượng
   - việc còn dở

   Cuối cùng tạo file rỗng docs/tasks/{TASK}.done.
=== PROMPT ===
