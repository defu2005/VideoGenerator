# TASK-147 — báo cáo tổng

**Ngày:** 2026-11-19. **Trạng thái:** hoàn tất phần code và tài liệu; chưa commit, chưa push.

## Đã làm

- **147a** (framework, adapter, vai trò, mặc định `app`): đã có từ trước, xem `TASK-147a.report.md` và `TASK-147a.done`.
- **147b** RESEARCH (`research_scout`, `research_submit_notes`, cổng: ≥6 ý chính, ≥60% có nguồn, trích dẫn ≤30 từ, nguồn không trỏ máy nội bộ hay miền bị chặn).
- **147c** MUSIC_SEARCH (`music_scout`, `music_submit_candidates`, cổng: giấy phép thuộc `COMMERCIAL_OK`, URL http(s), tối đa 8 bản cho mỗi job, app tải và đo thời lượng, agent không chọn bản cuối).
- **147d** SCRIPT (`script_writer`, `script_submit_draft`, cổng: lint, critic bằng route LLM của app, kiểm sự thật; giữ khi tổng <60, chính xác <3 hoặc có ý chặn; tối đa 2 lần nộp lại; `author = agent:<instance>` trong `script_drafts`). Xem `TASK-147d.done`.
- **Tài liệu (rule 12):**
  - `docs/ARCHITECTURE.md`: bảng stage, vai trò, cổng, lý do app giữ cổng.
  - `docs/user-guide/agent-nhan-stage.md`: mục "Bước nào giao được, và app kiểm tra gì".
  - `packages/shared/src/features/featureMap.ts`: mục `stage-agent-execution` (trỏ tới `buoc-giao-duoc`).
  - `docs/user-guide/nhat-ky-thay-doi.md`: mục 147a–d.
  - Vai trò: `research-scout`, `music-scout`, `script-writer`.
  - Kỹ năng vận hành: thêm đoạn về agent ngoài trong `video-stage-kich-ban`, `video-stage-nghien-cuu`, `video-stage-nhac`.
- **Công cụ:** mô tả đã có trong `apps/server/src/agents/toolDefs.ts`; đã đăng ký trong `apps/server/src/auth/toolActions.ts`. `apps/mcp` không liệt kê công cụ stage nên không cần sửa.

## Lỗi đã sửa trong phiên này

- `video-stage-kich-ban/SKILL.md` chứa ký tự `…` trong một dòng mới. Bộ nạp kỹ năng coi đó là chữ giữ chỗ và từ chối cả file. Hậu quả: `agentSkillPack.test.ts` lỗi 3 test. Đã thay bằng chữ thường; 28/28 test liên quan pass.
- Hai chỗ trong tài liệu nêu sai: giới hạn nhạc là "mỗi lượt" (đúng là mỗi job), và ghi vào bảng `scripts` (không có, chỉ `script_drafts`). Đã sửa.
- Đã bỏ hai khẳng định không kiểm chứng: `author` trên ghi chú nghiên cứu và ứng viên nhạc.

## Kiểm chứng

- `npm run typecheck`: exit 0.
- `npm test` (toàn workspace): exit 0.
  - `apps/server`: 262 file, 2060 pass, 8 skip.
  - `packages/shared`: 98 file, 788 pass.
  - `apps/mcp`: 7 file, 65 pass.
  - `apps/web`: 90 file, 246 pass.
- `npm run build`: exit 0 (chỉ có cảnh báo kích thước chunk của web, không phải lỗi).

## Còn mở (không chặn)

- App executor chưa xóa `author` khi chạy lại SCRIPT, nên `agent:…` có thể còn sau một lần app sửa. Đã ghi trong skill `video-stage-kich-ban`. Cần sửa trong code, không làm trong task này.
- `script_submit_outline` hoãn cùng TASK-146 (đã nêu trong `TASK-147d.done`).
- Chưa chạy agent thật trên Hermes; chưa đo chất lượng cổng với dữ liệu thật. Kiểm chứng chỉ là unit test với agent giả và mock LLM, đúng yêu cầu task.
