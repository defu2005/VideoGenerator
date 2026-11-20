# TASK-145 — fix2: báo cáo (2026-11-19)

**Trạng thái:** P1 chấm lại và accounting có trong working tree, đã kiểm chứng bằng test. P2 còn mở. Chưa review lại. Không sửa `TASK-145.review.md` hay `TASK-145.done`. Chưa commit, chưa push.

**Ngoại lệ sản phẩm một lần (ruling advisor 2026-11-19):** sửa `rescoreCritique` trong `apps/server/src/services/scriptService.ts`. Không đổi schema, migration hay enum.

## Sửa trong đợt này
- `rescoreCritique`: bọc `repository.atomic` trong try/catch. Khi 409 `CONCURRENT_MODIFICATION`, ghi một job FAILED mang `usage` của lần gọi LLM rồi ném lại lỗi. Trước đó usage mất cùng transaction.
- Test mới: "records the paid rescore usage as FAILED when the script changes during the call" (`storyEngine.test.ts`).
- Test có sẵn được bổ sung: `quality_score` 9.2 và một job SUCCEEDED với `llmCalls` 1.
- Test có sẵn "handles hook switching…" được bổ sung: câu thứ hai của narration và `outro` không đổi sau `switchHook`. Test cho thấy `switchHook` chỉ đổi câu đầu.

## Kiểm chứng
- `storyEngine.test.ts`: 4/4 pass.
- `npx tsc --noEmit` trong `apps/server`: exit 0.
- Full suite `apps/server` chạy trước khi thêm assertion switchHook (product code không đổi sau đó): 243 file pass, 1954 test pass.

## Đối chiếu từng finding của review
- **P1 chấm lại bỏ qua computeScriptCritique và job/usage:** đã sửa sẵn. Thang `total/10` khớp `storyEngine.ts:765`.
- **P1 viết lại cục bộ:** merge chỉ thay section trong `failingSectionIds`, giữ object gốc cho phần còn lại (`storyEngine.ts` ~615–625). Section lạ bị bỏ qua vì merge duyệt theo danh sách gốc. **Chưa có test** cho ca section lạ. Mở.
- **switchHook:** đã có assertion (xem trên). Đóng.
- **chosenId vs chosenHookId:** `storyEngine.ts:335–336` đọc `chosenHookId ?? chosenId`. Đã đúng.
- **Rubric 6 chiều, `blocking_facts` dùng Math.max:** đã đúng (đọc code).
- **Stop rule:** guide dòng 108 và 220: dừng khi không tăng ≥ 3. Code (`storyEngine.ts` ~640–652) dừng khi `gain <= 0` và khi `gain < 3`. Khớp.
- **Ngân sách số lần gọi (đã đối chiếu 2026-11-19):** code và `modes.ts:596–614` khớp nhau: full = outline 1 + critic 4 (1 critic chọn hook tại `storyEngine.ts:378`, 3 lần critic narration: lần đầu + sau mỗi vòng rewrite) + rewrite 2 + length fit 1 = 8. Guide `TASK-145.md:224` ghi 7 là số cũ; đã sửa thành 8 (lite tối đa 4).
- **USER luôn stale:** `scriptService.ts:234–241` so `input_hash` với hash nội dung, không đọc origin. Còn kiểm: rescore ghi `input_hash` và GET khi outline null. Xem mục test rescore.
- **Benchmark CLI:** hoãn sang guide riêng. Ruling advisor 2026-11-19.

## Đọc usage và trạng thái
- `financeService.ts:1047–1052` và `usageService.ts` (mệnh đề `clauses`): chỉ lọc `usage IS NOT NULL`, không lọc status. Dòng FAILED mới **được cộng vào chi phí**.
- Trạng thái stage đọc từ `project_stages` (`jobRepository.ts:200`), không đọc từ job mới nhất. Vì vậy **không xác nhận được** "defect cũ" về job FAILED stage SCRIPT làm Script hiện lỗi. Đã bỏ khỏi ghi chú.

## Mở
- Rewrite allowlist: test cho section lạ.
- Ngân sách `full`: budget 8 so với code 7 (xem trên). Mở.
- Benchmark CLI: hoãn.

## Cập nhật 2026-11-19: test rewrite allowlist và rescore stale đã pass

- `apps/server/test/storyEngine.test.ts`, test "rewrite merge changes only failing sections and drops ids outside the failing set (TASK-145)": pass. Mock critic lần 1 trả điểm 0 ở section `context`; lần 2 trả điểm 5. Rewrite vòng 1 được chấp nhận (0 → 100), id `ghost-section` bị loại, `hook` không đổi, `context` thành "Đoạn đã sửa.". Vòng 2 bị kích hoạt bởi fix-lint ở `opening`, gain 0, dừng. Nguyên nhân lỗi cũ duy nhất: mock length-fit trả mẫu mặc định và ghi đè `context`. Mock length-fit nay trả lại `currentScript` nguyên trạng. (Trường `total` không liên quan: schema có `total` optional, thêm lại vẫn pass.)
- Test rescore cũ bổ sung khẳng định `critiqueStale` = false sau rescore và tổng điểm 92 (pass). Đây là bằng chứng cho đường USER-stale ở `scriptService.ts:234–241`.
- `npx vitest run test/storyEngine.test.ts`: 5/5 pass. `npx tsc --noEmit` (apps/server): không lỗi.
- Không commit, không push.
