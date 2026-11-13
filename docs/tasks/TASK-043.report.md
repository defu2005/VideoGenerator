# TASK-043 report

## What changed

- Seven format recipes, a fallback picker, and a treatment card stored on the project when a script is saved.
- The script prompt names the recipe and section keys. Brief has **Mẫu video**.
- After a tagged script, or when a format was chosen, a missing required section is added to the review notes. The script is still accepted.
- Timeline has `revision`. Chat, the assistant, and MCP apply timeline proposals through `ReviewService.applyRawProposal`.
- A stale `baseRevision` returns HTTP 409 `TIMELINE_CHANGED`.
- Each timeline write keeps a snapshot. The newest 30 stay. **Hoàn tác** restores the previous copy. A voice path is checked inside the project folder, so a file that is still there stays, and a deleted file clears that scene's voice.
- New proposals: transition, emphasis, graphics, subtitle style, delete, split, and regenerate voice. Split copies the scene row and cuts the narration by word. Regenerate deletes that scene's voice row and marks VOICE stale. It does not call TTS.
- The script page shows **Bản đề xuất**, including the remaining token and TTS estimate from `estimateBudget`. The daily Telegram summary lists the format. AUTO adds one `FORMAT_CHOSEN` info row.
- The brief format control is a set of cards with the Vietnamese description. Review proposals show a narration, transition, order, or graphic preview. After apply, the page offers the 10-second window.
- Learning rows include `format` and the insight prompt reads it.
- Migration `0040_last_echo.sql` from `drizzle-kit generate`. A second generate reported no schema changes.

## Tests

- `packages/shared/test/formats.test.ts` and `timelineEdit.test.ts`.
- `apps/server/test/timelineSnapshots.test.ts` (cap 30), plus review, script, and assistant tests.
- `apps/server/test/reviewApplyPath.test.ts` kiểm tra MCP và trợ lý cùng gọi `applyRawProposal`.
- Web `ReviewChatPanel` and `ScriptTab` tests.
- `tsc --noEmit` passed for `apps/server` and `apps/web`.

## Deviations

- Khi đã chọn mẫu mà thiếu mục bắt buộc, có một lượt `ScriptSectionRepair`. Nếu vẫn thiếu thì ghi chú và vẫn lưu. Kịch bản cũ không gắn mẫu thì không gọi lượt này.
- Khi dự án đã chọn mẫu, bước kế hoạch cảnh dùng điểm giữa của `targetSceneSec` và xoay `visualMix` vào câu tìm hình. Timeline dùng preset dựng của mẫu. Dự án chưa chọn mẫu giữ nhịp `story` và độ dài cảnh của dự án.
- Trang tổng quan và tab Token hiện «Ước tính vs thực tế» khi dự án đã lưu bản đề xuất.
- Lời nhắc nghiên cứu và kịch bản gộp có cấu trúc mẫu. Độ sâu nghiên cứu lấy mức sâu hơn giữa ngân sách và mẫu (`normal` thành `standard`). Chưa chọn mẫu thì giữ độ sâu của ngân sách.
- Khi chưa chọn mẫu và ngân sách bật `formatPick`, bước kịch bản gọi một lượt `FormatPick`, lưu id và lý do. Lỗi thì dùng luật mã. Trang tổng quan hiện tên mẫu và lý do.
- Kế hoạch dựng nhận preset và gợi ý đồ họa của mẫu. Khi đồ họa động bật, timeline gắn đồ họa fallback theo `sectionKey`.
- Mỗi loại đề xuất mới áp được lên timeline. Đề xuất trỏ cảnh hoặc đồ họa không có thì bị bỏ, kèm ghi chú tiếng Việt.
- Bước ghép cuối đã phủ đồ họa và trộn SFX khi có thời điểm từ. Báo cáo TASK-041 và TASK-042 ghi phần đó.
- No live check on `eb02c679-26a3-4a42-8ea9-bb4e1a25288d`. The browser was not clicked. `npm test --workspaces` later passed at 23:20 (Asia/Bangkok): shared 334, mcp 14, server 649 passed and 1 skipped, web 149.
