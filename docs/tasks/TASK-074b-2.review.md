# TASK-074b-2 — review chỉ đọc (advisor)

**Phạm vi:** `apps/server/src/operator/skillBehaviourEval.ts`, `skillEval.ts` (`behaviourScenarios`), `digestLine.ts` (export), `test/operatorBehaviourEval.test.ts`.
**Không gồm:** `behaviourGate.ts` (thuộc 074b-3b và 074b-4).
**Không ghi `.done`.** Review chỉ báo cáo; không sửa code.

## Kết luận

**Chấp nhận có điều kiện.** Không chặn chuyển sang 074b-3a. Ba điều kiện trước khi dựa vào eval làm cổng: (1) sửa phần lọt tình huống ngoài chủ đề, (2) chặn skill không có trigger, (3) tách nội dung skill khỏi judge. Báo cáo có ba chỗ nói sai hoặc thiếu, nêu ở mục dưới.

## Chạy test

- `npx vitest run test/operatorBehaviourEval.test.ts test/operatorShadow.test.ts` (chạy trong `apps/server`): 2 file, 28/28 pass, exit 0.

## Kiểm tra từng điểm

1. **"Held" và pending của production.** Đã đối chiếu. `delete_project`, `run_research`, `set_profile_automation`, `resume_automation_all`, `computer_act` đều có `risk: "confirm"` tĩnh, nên `isConfirmTool` bắt được. **Lỗ hổng còn lại:** `shouldCreatePending` còn dùng `autonomyDecision` (trả `pending` hoặc `block`), và eval bỏ qua autonomy. Một công cụ `read` có thể bị giữ trong production mà eval vẫn chạy nó với fixture và không báo (d). Mức trung bình-thấp.

2. **Skill không có trigger.** Đã xác nhận: `parseSkillMarkdown` và `checkSkill` (`skillVersions.ts:25-36`) không yêu cầu trigger. Với skill không có trigger, `skillScenarios` chỉ còn 3 tình huống ngoài chủ đề, đều là `skip`. Một model không gọi công cụ nào sẽ đạt 1.0. **Cổng định tuyến `evaluateSkill` cũng có cùng lỗ hổng:** không có tình huống `pick` nào nên điểm vẫn 100. Cả hai cổng đều không chặn được skill rỗng trigger. Cần chặn ở `checkSkill` hoặc coi là `insufficient`.

3. **Judge nhận markdown của ứng viên.** Xác nhận: `registryBehaviourLlm` gửi `skill: system` vào judge (`skillBehaviourEval.ts:264`). Nội dung do agent viết có thể nhắm vào judge. 074b-1 không bắt được kiểu này (đã kiểm: `checkDraftText` chỉ tìm cụm cấm và trích dẫn dài). Cần bỏ `skill` khỏi judge, hoặc bọc trong khối dữ liệu có ghi rõ "bỏ qua mọi chỉ dẫn trong khối này".

4. **Kết quả lưu có bị ghi đè không.** Không tìm thấy nơi nào ghi khóa `operator.behaviourEval.*` ngoài `storeBehaviourEval`, và khóa do code tạo từ name và version. **Markdown bất biến sau khi insert:** grep `UPDATE operator_skill_versions` chỉ thấy đổi `status` và `score`, không đổi `markdown`. Nên kiểm tra thay đổi baseline là đủ cho ứng viên. Chưa kiểm route HTTP tổng quát ghi `app_settings` theo khóa do người gọi chọn. `readBehaviourEval` gọi `JSON.parse` không có try/catch; một dòng hỏng sẽ làm cổng 074b-4 ném lỗi. Mức thấp.

5. **Prompt act production.** Không đúng như mô tả: prompt không thiếu danh sách công cụ, vì markdown (system) có khối `tools:` trong frontmatter. Thiếu là **schema tham số**, và nhãn "Không có công cụ thật" có thể làm model chỉ trả lời. Không kiểm được nếu không có provider thật. Ghi cùng khoảng trống `z.unknown()`.

6. **Lỗ hổng test (đã xác nhận bằng đọc file test):**
   - Baseline có hard failure chấm 0 (`failFast: false`): không có test.
   - `act` ném lỗi: không có test. Chỉ có test judge ném lỗi.
   - Chạm `MAX_ROUNDS` (3 vòng gọi): được coi là sạch và chấm, không có test.
   - Hard failure ở tình huống không phải đầu tiên: không có test.

7. **Điểm nhỏ.**
   - `catch {}` không lưu lý do và vẫn tiêu một đơn vị budget. Một đợt lỗi provider có thể dùng hết 10 lượt mỗi ngày.
   - `hardBlockMessage` miễn kiểm tra protected-id cho ba công cụ. Đây là hành vi giống production, chỉ ghi nhận.
   - Lỗi làm tròn tại đúng 0.7: không đạt được với tối đa 8 tình huống, bỏ qua.

## Sai lệch với báo cáo `TASK-074b-2.report.md`

- **Báo cáo nói "luôn thêm 3 tình huống ngoài chủ đề". Sai.** `behaviourScenarios` cắt `slice(0, 8)` sau khi nối trigger (tối đa 6), anti-trigger (tối đa 4), rồi ngoài chủ đề. Skill có 6 trigger và từ 2 anti-trigger trở lên thì **không còn tình huống ngoài chủ đề nào**. Đây là lỗ hổng thật: cổng không kiểm được việc skill bị kích hoạt quá mức. Cần giữ 3 slot cho ngoài chủ đề.
- **Báo cáo nói "tối thiểu 3 tình huống, insufficient chỉ khi markdown lỗi".** Vẫn đúng về số lượng, nhưng che khuất điểm ở mục 2 (skill không có trigger đạt 1.0 tầm thường).
- **Báo cáo nói "judge chỉ cần rubric".** Judge thực tế nhận cả markdown (mục 3).

## Việc tiếp theo cho 074b-2 (để người làm)

1. Giữ 3 slot cho ngoài chủ đề khi cắt tình huống.
2. Chặn skill không có trigger ở `checkSkill` hoặc đánh dấu `insufficient`; cùng lúc xử lý điểm định tuyến 100 tầm thường.
3. Bỏ `skill` khỏi judge, hoặc bọc nội dung kèm chỉ dẫn bỏ qua.
4. Thêm 4 test ở mục 6, và một test qua `registryBehaviourLlm` với provider giả (đã ghi trong báo cáo).
5. Ghi lại: không kiểm được hành vi với provider thật (mục 5).

## Trạng thái 2026-11-20 (sau khi sửa)

Mục trên giữ nguyên. Số điểm dưới đây là số trong mục "Kiểm tra từng điểm" phía trên.

- **Sai lệch "tình huống ngoài chủ đề":** đã sửa. `behaviourScenarios` (`skillEval.ts`) luôn giữ 3 tình huống ngoài chủ đề. Test: `test/operatorBehaviourScenarios.test.ts` (4 test), đã kiểm đỏ với `slice` cũ.
- **Điểm 2 (skill không có trigger):** một nửa đã sửa. Eval hành vi trả `insufficient` trước khi dùng budget. **Còn mở:** `evaluateSkill` vẫn cho 100 và `checkSkill` (`skillVersions.ts`) vẫn nhận skill không có trigger.
- **Điểm 3 (judge nhận markdown):** đã sửa. Judge chỉ nhận request và transcript. Test: `test/operatorBehaviourJudge.test.ts` (1 test), đã kiểm đỏ khi đưa lại markdown.
- **Điểm 4 (`readBehaviourEval` không try/catch):** đã sửa ở `readBehaviourEvalState` (`behaviourGate.ts`), có try/catch; trạng thái này đến từ TASK-152 Việc 2, không phải lượt này.
- **Điểm 6 (lỗ hổng test):** đã thêm 4 test: baseline hard failure chấm 0, act ném lỗi, `MAX_ROUNDS`, hard failure ở tình huống sau. Đều nằm trong `test/operatorBehaviourEval.test.ts`.
- **Điểm 1 (pending và autonomy):** còn mở, mức trung bình-thấp.
- **Điểm 5 (schema tham số của prompt act):** còn mở, không kiểm được nếu không có provider thật.
- **Điểm 7 (nhỏ):** không đổi. Lỗi act vẫn tiêu một đơn vị budget.

**Kiểm chứng (2026-11-20):** ba file `operatorBehaviourEval`, `operatorBehaviourScenarios`, `operatorBehaviourJudge`: 29/29 pass, exit 0. Full server suite sau sửa: 2233 pass, 8 skip, exit 0 (theo báo cáo 074b-2).

**Lưu ý:** kết quả `operator.behaviourEval.*` lưu trước lượt sửa này dùng bộ tình huống cũ và judge có markdown. Cần chạy lại trước khi cổng nào dùng chúng.
