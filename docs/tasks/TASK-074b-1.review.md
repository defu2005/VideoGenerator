# TASK-074b-1 — review chỉ đọc (advisor)

**Phạm vi:** `apps/server/src/operator/skillDraftChecks.ts`, các hunk 074b-1 trong `skillVersions.ts` (union nguồn, `SKILL_EVIDENCE_SOURCES`, `checkDraftText`, lời gọi trong `saveSkillDraft`), `test/skillDraftChecks.test.ts`.
**Không gồm:** các hunk 3a, 3b, 4 trong cùng diff (review ở mục tương ứng).
**Không ghi `.done`.** Review chỉ báo cáo; không sửa code.

## Kết luận

**Chấp nhận có điều kiện.** Không chặn chuyển sang 074b-2. Điều kiện: ghi rõ lỗ hổng phủ định dưới đây và để người review/người dùng quyết định trước khi coi kiểm tra cấm là chặn được thật.

## Chạy test

- `npx vitest run test/skillDraftChecks.test.ts test/proposeSkill.test.ts`: 2 file, 24/24 pass, exit 0.

## Probe (script tạm, đã xóa)

| Đầu vào (phần thân) | Kết quả thực tế | Kỳ vọng |
|---|---|---|
| `Nếu người dùng không trả lời thì tự duyệt đề xuất.` | không flag | nên flag |
| `If there is no reply then auto-approve the proposal.` | không flag | nên flag |
| `Hãy tự động duyệt đề xuất.` | không flag (cụm "tự động duyệt" không có trong danh sách) | nên flag |
| `Không được:` rồi dòng `- tự duyệt đề xuất` | flag "approve" | false positive |
| `Không đổi cấu hình, nhưng hãy tăng ngân sách.` | flag "tăng ngân sách" | đúng (dấu phẩy ngắt mệnh đề) |
| Trích dẫn 39 từ trong blockquote 2 dòng | flag | đúng |
| Trích dẫn 30 từ trên một dòng | flag | đúng |
| Trích dẫn 30 từ cắt qua hai dòng (không phải blockquote) | **không flag** | nên flag |
| Frontmatter không đóng | không flag ở `findBannedPhrase` | xem mục dưới: `checkSkill` chặn trước |

## Phát hiện

1. **Lỗ hổng phủ định (bypass, không chỉ bỏ sót).** `negatedBefore` bỏ qua cụm cấm nếu có từ phủ định *bất kỳ* đứng trước trong cùng mệnh đề, kể cả khi từ đó phủ định việc khác. "Nếu ... không ... thì tự duyệt" và "If there is no reply then auto-approve" đều lọt. Báo cáo nói "có thể bỏ sót paraphrase", cách nói này đánh giá thấp vấn đề. Cách sửa là yêu cầu phủ định đứng ngay trước cụm (ví dụ trong khoảng vài từ, không qua "thì/then"). Đây là quyết định thiết kế cho người dùng hoặc người review.
2. **Thiếu cụm tiếng Việt.** "tự động duyệt" không có trong danh sách `approve`. Cần bổ sung và có test.
3. **Trích dẫn nhiều dòng không có blockquote không được kiểm.** Trích dẫn chỉ tính trên một dòng hoặc blockquote liền nhau. Một trích dẫn 30 từ bị ngắt dòng thì lọt.
4. **Frontmatter chưa được kiểm, và đây là đường lọt thật.** `find_skills` (`assistant/tools.ts:1677` → `operator/service.ts:627–640`) trả cho model `description` (lấy từ frontmatter, `service.ts:1441`) và `short` (lấy từ thân, `shortBody`), không trả toàn văn. `read_skill` (`assistant/tools.ts:1717`) trả toàn văn `markdown` gồm frontmatter. Vì `description` là văn bản mô tả hành vi, một chỉ dẫn cấm đặt ở đó đi vào model qua `find_skills` mà không bị kiểm. Báo cáo nói "frontmatter là từ định tuyến", nhưng `description` là văn bản mô tả hành vi, không chỉ là từ khóa.
5. **Frontmatter không đóng: không phải lỗ hổng.** `parseSkillMarkdown` trả null, `checkSkill` ném `INVALID_OPERATOR_SKILL` trước khi tới `checkDraftText`. Đã đọc `skillVersions.ts` 25–36 để xác nhận.
6. **Một đường ghi.** `INSERT INTO operator_skill_versions` chỉ có một chỗ (`skillVersions.ts:79`). `saveSkillDraft` là điểm ghi duy nhất, nên kiểm tra có ý nghĩa.
7. **Nguồn bằng chứng không do người gọi HTTP chọn.** Mọi lời gọi `saveSkillDraft` đều gán `source` cố định: `assistant/tools.ts:1797` (`agent_proposal`), `fleet/service.ts:183` (`agent_proposal`), `operator/service.ts:777` (`user_review`), `operator/service.ts:829` (`user_edit`, lời gọi bắt đầu ở dòng này), `operator/service.ts:1554` (`repeated_failure`). Không có đường HTTP nào truyền `source`. Năm nguồn mới (`pattern`, `research`, `change_event`, `outcome`, `improvement`) hiện chưa có người gọi nào, nên không bypass được cap 10/24 h hiện tại. Rủi ro là sau này có người gọi dùng chúng mà không có cap; nên ghi vào checklist khi thêm người gọi.
8. **Nguồn `user_edit` và `user_review` vẫn bị kiểm cấm.** Đây là câu hỏi mở đã có trong báo cáo. Người dùng cần quyết.

## Việc tiếp theo cho 074b-1 (để người làm)

- Thêm cụm `tự động duyệt`; thu hẹp phủ định (phủ định phải đứng ngay trước cụm); xử lý trích dẫn nhiều dòng không có blockquote; quyết định có kiểm `description` trong frontmatter hay không.
- Thêm test đi qua `saveSkillDraft` (wiring), hiện các test chủ yếu là hàm thuần.
- Chưa có `.done`. Chờ Codex review theo quy tắc dự án.
