# TASK-152 — báo cáo

**Trạng thái:** code đã viết bởi Claude (theo lệnh người dùng 2026-11-20: "bỏ mọi quy tắc trước đây đi, nghe theo advisor hoàn toàn"). Advisor đã review, ký checkpoint 6 ngày 2026-11-20 (có điều kiện: sửa cách ghi kết quả test, đã sửa). Không có `.done`. Chưa commit, chưa push.

**Ghi chú về ai viết:** Claude tự sửa code, không qua opencode. Review do advisor thực hiện (người dùng, 2026-11-20: không dùng Codex review nữa).

**Đánh số:** mục "Việc" trong báo cáo khác với số trong guide `docs/cursor/TASK-152.md`. Báo cáo: 1 = guide Việc 1; 2 = Việc 2; 3 = Việc 3; 4 = Việc 5 (`allowed` của listing); 5 = Việc 6c (test rollback); 6 = Việc 4 (sửa báo cáo và tên test). Việc 6a, 6b, 6d, 6e, 6f và Việc 7 nằm trong các mục "Việc không làm" và "Lệch so với guide".

## Việc đã làm

| Việc | Nội dung | File | Test đỏ trước |
|---|---|---|---|
| 2 | `readBehaviourEvalState` (mới): JSON hỏng, hoặc JSON không phải object (`null`, mảng, số), được coi là hỏng: không ném lỗi, không đọc như kết quả, ghi cảnh báo. `behaviourReason` trả lý do riêng "eval hành vi không đọc được: chạy lại eval hành vi". `readBehaviourEval` vẫn trả `null` khi hỏng (fail closed). | `src/operator/behaviourGate.ts` | `test/behaviourGateFailClosed.test.ts` (6 test); `test/operatorShadowGate.test.ts` "a corrupt eval row is a coded refusal…" (service: `setShadowSkill` trả `SKILL_BEHAVIOUR_NOT_RUN`, `skillVersions()` vẫn liệt kê, kèm lý do); cùng file: `null` row trước khi sửa làm `TypeError` |
| 1 | Đường chat: `find_skills` nhận một `turnId` mỗi lượt gửi, không phải `runId`. `buildToolContext` gán `turnId ?? randomUUID()`, nên cả lời gọi không có lượt riêng (`toolContext()`, pending action) cũng không ghi `run_id` NULL. Không đổi cách đếm: `COUNT(DISTINCT COALESCE(run_id, id))` đã đếm dòng NULL một lần. | `src/assistant/tools.ts`, `src/assistant/service.ts` | `test/assistant.test.ts` "TASK-152 1" (đi qua `sendAssistantMessage`, hai lời gọi `find_skills` cùng lượt và một lượt khác); `test/operatorShadow.test.ts` "counts shadow runs by chat turn" (cùng lượt → 1 lượt, lượt khác → 2). Chưa có test riêng cho nhánh mặc định `randomUUID()`. |
| 5 | Rollback: bơm lỗi DB sau khi flip shadow→draft, shadow và active giữ nguyên | (không đổi code, đây là test bảo vệ) | `test/operatorAutoActivation.test.ts`, "rolls the flip back" (xanh ngay, vì flip đã nằm trong transaction) |
| 6 | Đổi tên test "archives" thành "draft" (chỉ đổi tên) | `test/operatorShadow.test.ts:199` | — |
| 3 | Kiểm cấm: thêm "tự động duyệt", "auto approve"; phủ định chỉ trong 4 từ trước cụm từ và không vượt qua liên từ `thì`/`then`/`nhưng`/`but`/`rồi`/`mà`/`và`/`and` (thêm `mà`, `và`, `and` sau khi probe bắt được false negative). "or" cố ý không có trong danh sách liên từ, vì "never ask or auto approve" là cấm cả hai nhánh; kiểm `description` trong frontmatter (không kiểm trigger); trích dẫn xuống dòng trong cùng đoạn | `src/operator/skillDraftChecks.ts` | các test đỏ trước trong `test/skillDraftChecks.test.ts` (xem "Test mới / đổi") |
| 4 | `skillVersions()`: bản `shadow` có `activation.allowed = false`, kèm lý do; bản `needs_merge` có `allowed = false` với lý do "Gộp thay đổi thành bản nháp mới trước khi kích hoạt" (trước khi sửa, listing báo `allowed: true` trong khi kích hoạt từ chối); `archived` và `active` vẫn `allowed: true` (archived để khôi phục được) | `src/operator/service.ts` | `test/operatorAutoWiring.test.ts` "TASK-152 4" và "TASK-152 5"; `test/operatorShadowGate.test.ts` (needs_merge) |

## Việc không làm, và vì sao

- **Việc 7 (Dockerfile DATA_DIR):** bỏ theo advisor. Không sửa Dockerfile. Lệch giữa `HEALTHCHECK` (`/data`) và worker (`./data`) vẫn còn, ghi lại ở đây để theo dõi. Trong image hiện tại không gây lỗi vì `ENV DATA_DIR=/data`.
- **Việc 6b (ghi file sau khi DB đã active): đã sửa code, không chọn hướng nào trong hai hướng của guide.** Guide đưa hai lựa chọn: ghi file trước khi commit, hoặc ném lỗi trong transaction để rollback. Đã chọn hướng thứ ba: DB vẫn commit, lỗi ghi file thành finding `skill_file_write` (dedupe `skill-file-write:<tên>`), và lượt sync kế tiếp ghi lại file từ DB rồi đóng finding. Lý do: rollback khi lỗi đĩa sẽ hủy một kích hoạt mà người dùng đã duyệt. Test theo guide "ghi file thất bại → bản đích không active" không được viết đúng như guide; thay bằng "ghi file thất bại → vẫn active, có finding, lượt sau tự sửa" (`test/operatorSkillFileWrite.test.ts`, mục 074b-4 4–5). **Đính chính giả định cũ:** "syncWorkspace() ghi lại `skills/user/*.md` từ DB" là sai. `writeOperatorWorkspace` (`workspace.ts:89`) chỉ ghi skill từ code và repo; vì vậy đã thêm `syncUserSkillFiles()` trong `operator/service.ts`.
- **Việc 6c (nhánh AppError sau flip):** không tìm được đường đi thực tế. `autoEligibility` chạy cùng các kiểm tra mà `activateSkillVersionInTx` chạy sau flip (điểm số, hành vi, trạng thái). Chỉ lệch tên (`SKILL_NAME_MISMATCH`) mới có thể xảy ra, và chỉ khi dòng DB bị sửa tay. Test rollback dùng lỗi DB bơm vào, không phải AppError.

## Quyết định về `runId` (theo advisor)

Ban đầu kế hoạch là đặt id lượt chat vào `ctx.runId`. Đã bỏ vì `computerUse/service.ts:123–141` (`begin()`) khóa phiên Computer Use theo `runId ?? "direct"`. Gán id mỗi lượt sẽ:
- tách phiên `computer_observe` (chạy trong vòng lặp) khỏi `computer_act` (chạy qua pending action, vẫn ở "direct") và làm mất cờ `tainted` dùng chung;
- reset giới hạn bước mỗi lượt, và timeout thành reset thay vì ném lỗi;
- làm `sessions` lớn dần theo mỗi lượt.

Thay vào đó dùng trường mới `turnId`, chỉ `find_skills` đọc (`ctx.runId ?? ctx.turnId ?? null`). `computer_observe`, `computer_act` và audit không đổi. Kiểm tra migration 0098: `run_id` không có khóa ngoại tới `operator_runs`, nên id lượt chat không gây lỗi.

## Kết quả kiểm tra

- `npx tsc --noEmit` trong `apps/server` (2026-11-20, sau khi sửa): exit 0.
- Bộ tập trung (8 file: `skillDraftChecks`, `proposeSkill`, `operatorShadow`, `operatorShadowGate`, `operatorAutoActivation`, `operatorAutoWiring`, `behaviourGateFailClosed`, `assistant`): 8 file pass, 134/134 test pass, exit 0.
- Toàn bộ server (`npx vitest run`, chạy nền, qua `2>&1 | tail -n 40`): kết quả dựa trên dòng tóm tắt của vitest, không dựa trên exit code (exit 0 là của `tail`, không phải của vitest). Dòng tóm tắt: 273 file pass, 4 file skip; 2215 test pass, 8 test skip; không có dòng failed. Thời gian 413,63 giây. Không timeout.
- Số cũ (2205 test, 124/124 bộ tập trung) là trước khi thêm các test sau sửa; số trên là số đọc được sau khi sửa xong.

## Test mới / đổi

- `test/behaviourGateFailClosed.test.ts` (mới, 6 test): JSON hỏng, không có dòng, lý do "chưa chạy", dòng `null`/`[]`/`42`, shadow gate với dòng hỏng, kích hoạt thủ công bị từ chối và draft vẫn là draft
- `test/operatorShadowGate.test.ts`: "a corrupt eval row is a coded refusal…" (mới)
- `test/operatorShadow.test.ts`: "counts shadow runs by chat turn" (mới)
- `test/operatorAutoWiring.test.ts`: "TASK-152 5", archived vẫn `allowed: true` (mới)
- `test/assistant.test.ts`: "TASK-152 1" (mới)
- `test/operatorAutoActivation.test.ts`: "rolls the flip back" (mới, bảo vệ)
- `test/operatorAutoWiring.test.ts`: "TASK-152 4" (mới)
- `test/skillDraftChecks.test.ts` (Việc 3):
  - "flags an approve instruction joined to a negated clause by 'mà' or 'and'" (`Không cần hỏi mà tự duyệt đề xuất.`, `Đừng chờ người dùng mà tự duyệt.`, `Do not ask and auto approve the proposal.`)
  - "still does not flag ... 'mà'" (`Không dừng lại mà không tự duyệt.` → không flag)
  - "refuses such a draft when it is saved" (wiring qua `saveSkillDraft`, skill `mo-ma`)
  - "counts a quote that is wrapped over two soft-wrapped lines of one paragraph" (3c)
  - "known false positive, pinned": `Không được:` + `- tự duyệt đề xuất` vẫn bị flag (dương tính giả đã biết, ghim hành vi, chưa sửa)
- `test/operatorShadow.test.ts:199`: đổi tên

## Lệch so với guide (cần cập nhật guide)

- Việc 7 code: bỏ.
- Việc 6b: không đổi code.
- Việc 1: dùng `turnId`, không dùng `runId`.
- Kiểm tra 3e "Không được:": đây là dương tính giả đã biết, không phải kỳ vọng pass.
- **Việc 2, lý do "eval hành vi không đọc được": đã thêm.** `behaviourReason` trả lý do riêng cho dòng hỏng; trước đó dòng hỏng hiển thị như "chưa chạy eval hành vi".
- **Việc 6a, sửa số test trong báo cáo 074b-4: không sửa trực tiếp.** Guide yêu cầu sửa số trong báo cáo. Thay vào đó đã thêm một mục hiệu chỉnh có ngày vào cuối `TASK-074b-4.report.md`, giữ nguyên nội dung cũ. Mục đó ghi: 32 test của 074b-4, 33 trong hai file (theo `TASK-074b-4.review.md:59`), và test dòng 213 (nay 224) thuộc TASK-151.
- **Việc 6c, test rollback:** test bơm lỗi DB, không phải AppError. Lý do: nhánh AppError sau flip không tìm được đường đi thực tế (đã nêu ở trên).

## Chưa làm / cần người dùng quyết

- `C:/Users/defu/AppData/Local/Temp/shadow.bak.ts` (do 074b-3a để lại): chưa xóa. Người dùng quyết giữ hay xóa.
- Các cờ tự kích hoạt (`autoActivateReadOnlySkills`) vẫn tắt.
- Advisor checkpoint 6 đã ký ngày 2026-11-20, có điều kiện (sửa cách ghi kết quả test trong mục "Kết quả kiểm tra", đã làm). Không có `.done`; việc gì còn lại thuộc mục known gaps dưới đây, không chặn.
- Probe phủ định còn sót (false negative, hướng nguy hiểm). Đã kiểm trong `skillDraftChecks.ts`:
  - `Đừng hỏi cứ tự duyệt.`: không bị flag. "cứ" không nằm trong danh sách liên từ.
  - `Không cần hỏi tự duyệt luôn.`: không bị flag. Không có liên từ giữa phủ định và cụm cấm.
  - Đã bắt được: `No need to ask just auto approve.` (đúng). `Không tự nhập và tự duyệt.` bị flag, nhưng câu này mơ hồ: "Không A và B" có thể đọc là cấm cả hai nhánh (như logic của "or" đã nêu) hoặc là chỉ thị tự duyệt sau khi không tự nhập. Hiện flag theo hướng an toàn; đây có thể là dương tính giả, giống trường hợp "Không được:" đã ghim.
  - Chưa thêm từ "cứ" hay "luôn" vào danh sách để tránh làm rộng bộ kiểm mà không có test kèm; cần quyết định riêng.
- Cột `run_id` NULL của các dòng cũ vẫn đếm kép (không migrate dữ liệu).
