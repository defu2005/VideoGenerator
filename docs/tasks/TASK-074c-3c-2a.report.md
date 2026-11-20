# TASK-074c-3c-2a — route POST /api/operator/tool-proposals/:id/draft (lát a) (báo cáo)

Trạng thái: route đã code và test trong cây làm việc, có runner và thư mục gốc được tiêm qua `buildApp({ proposalDraft })`. Production không tiêm gì nên route trả 503 cho đến lát (b). Không có runner LLM thật, không có `docs/proposals/`, không có trang, không có migration mới. Chưa commit, chưa push, chưa có `.done`. **ĐÃ ĐÓNG** (advisor, 2026-11-20), trên full suite lần 3 EXIT 0, route 12/12, tsc EXIT 0, không đổi code sau khi đo.

## Đã làm

- `apps/server/src/api/operator.ts`: `registerOperatorRoutes(app, operator, sqlite, proposalDraft?)`. Route `POST /api/operator/tool-proposals/:id/draft`:
  - Kiểm `request.actor?.kind === "user"` trước, nếu không thì 403 `OPERATOR_TOOL_PROPOSAL_USER_ONLY`. Kiểm này chạy trước khi parse id.
  - Parse id bằng zod (uuid, strict). Sai thì 400 `VALIDATION_ERROR`.
  - Không có `proposalDraft` thì 503 `OPERATOR_PROPOSAL_DRAFT_UNAVAILABLE`.
  - Gọi `draftProposal(sqlite, id, proposalDraft)`. Kết quả `drafted` chỉ trả `{ status, impNumber }`, không trả đường dẫn tuyệt đối hay thư mục gốc. Các kết quả khác trả nguyên.
- `apps/server/src/app.ts`: `buildApp({ config, testActor, proposalDraft })` nhận tuỳ chọn và truyền xuống `registerOperatorRoutes`. `index.ts` không đổi (vẫn `buildApp({ config })`).
- `apps/server/test/toolProposalDraftRoute.test.ts` (mới): 12 test. Danh sách test nằm trong file.
  - drafted: 200, file được ghi, `drafted_at` đặt, chi 1 `llmCalls`, không lộ thư mục gốc trong body.
  - already_drafted: lần gọi thứ hai không chi, không gọi runner.
  - not_accepted: id không tồn tại và dòng open đều không chi, không có số.
  - refused exists: giữ số, không chi, không gọi runner, file không đổi.
  - refused bad_root: thư mục không tồn tại, không chi, không gọi runner.
  - in_flight: lần gọi thứ hai khi lần đầu đang ở runner trả `skipped in_flight`; một lần gọi runner, một lần chi. Chờ runner bắt đầu bằng `Promise.race` với giới hạn 5 s.
  - runner ném lỗi: 500 `INTERNAL_ERROR`, dòng vẫn `accepted`, giữ số, `drafted_at` NULL, không có file, đã chi 1.
  - API key: 403 `OPERATOR_TOOL_PROPOSAL_USER_ONLY` cho id hợp lệ và cho `not-a-uuid`. Không có số, không chi, runner không được gọi. `testActor` được khôi phục trong `finally`.
  - `not-a-uuid` từ user: 400 `VALIDATION_ERROR`, runner không được gọi.
  - Không tiêm: 503, không có số, không chi.
  - Tripwire: `repoRoot()` trỏ đúng repo (kiểm `apps/server/package.json` tồn tại, đây là điểm neo dương), và `docs/proposals/` không tồn tại.
  - pending budget_limit: khi `llmCalls` hết thì trả `pending`, giữ số, không gọi runner. Test này nằm cuối file vì nó làm cạn `llmCalls` của app.

## Kết quả kiểm tra

- Đỏ trước code: 11 đỏ, 1 xanh (tripwire, xanh đúng như kỳ vọng vì nó chỉ kiểm sự vắng mặt). Lần chạy đỏ này bị `tail` cắt, nên chỉ ghi được 7 thông báo lỗi trong 11 lỗi.
- Test sửa do lỗi của chính test: vòng lặp làm cạn ngân sách bắt đầu từ 0 nên ném `SELF_IMPROVEMENT_BUDGET_LIMIT` (429) trong setup, vì các test trước trong cùng app đã chi một phần. Sửa: lặp từ `status.used.llmCalls`. Đây không phải lỗi route.
- Test in_flight đỏ ban đầu hết giờ 5 s ("runner never started") vì route chưa có. Đây là đỏ có kiểm soát, không phải treo.
- Ba mutation trên route trước đó (M1 1 đỏ, M2 2 đỏ, M3 1 đỏ): chỉ còn số đếm. Tên và nội dung từng mutation không khôi phục được: file ghi tên là `b6jyq2m2m.txt` không còn trong scratchpad, và `m1.txt`, `m2.txt`, `m3.txt` là file ngày 19/11 không liên quan. Các mutation này áp lên `api/operator.ts`: so `scratchpad/operator.orig.ts` (16:23, bản trước đổi tên) với `scratchpad/operator.3c2a.orig.ts` (16:43, bản hiện tại) chỉ ra ba dòng đổi tên `draft` → `proposalDraft`, không có khác biệt nào khác. Lúc đó việc hoàn nguyên được kiểm với `operator.orig.ts`. Chỉ mất nội dung từng mutation; số đếm và kết quả hoàn nguyên không bị ảnh hưởng. Không dùng ba mutation này làm bằng chứng riêng.
- Mutation có tên trong lát này: đưa kiểm user lên sau bước parse. Kết quả: 1 đỏ (test 403 cho `not-a-uuid` từ API key), 11 xanh. Hoàn nguyên bằng `cp` từ `scratchpad/operator.3c2a.orig.ts`, `cmp` in `RESTORED_IDENTICAL`. Sau đó route 12/12 xanh và `npx tsc --noEmit` EXIT 0.
- Lệnh `sed -i` trên file CRLF bằng Git Bash làm `diff` in toàn file (`1,224c1,224`), không phải một dòng. Vì vậy không dùng diff toàn file để xác nhận mutation. Việc hoàn nguyên của lần đổi kiểm user (ở trên) đã kiểm bằng `cmp` với file backup.
- Thứ tự thời gian của `api/operator.ts`: backup `operator.3c2a.orig.ts` 16:43:29; `cp` hoàn nguyên 16:43:43; log chạy full suite lần 2 kết thúc 16:41:46. Tức là backup được tạo sau khi lần 2 kết thúc, nên mtime không chứng minh được nội dung lúc lần 2 chạy là nội dung hiện tại. Bằng chứng cho nội dung hiện tại là: route 12/12 và `tsc` EXIT 0 chạy sau lần hoàn nguyên, và full suite lần 3 (xem mục Full suite).
- Sau khi đổi tên `draft` → `proposalDraft`, thêm điểm neo tripwire và kiểm `not-a-uuid` từ API key: 3 file liên quan (`toolProposalDraftRoute` 12, `proposalDraft` 17, `toolProposalAccept` 13) đều xanh: 42/42 đã chạy trong lần này.
- `npx tsc --noEmit` trong `apps/server`: EXIT 0. Lưu ý: `tsconfig.json` có `"include": ["src/**/*.ts"]` và `"exclude": ["test"]`, nên tsc không kiểm file test. Không có kiểm kiểu nào cho `toolProposalDraftRoute.test.ts` ngoài vitest.

## Full suite

Lần 1 (log `scratchpad/server-full-3c2a.log`, EXIT 1, chạy 16:27–16:34): 284 file đạt, 4 bỏ qua, 1 file lỗi (289); 2346 test đạt, 9 bỏ qua, 1 lỗi (2356). Lỗi duy nhất: `test/visionMax.test.ts` "refuses a missing or undersized source instead of scoring a placeholder", `Test timed out in 30000ms` (ghi nhận 34470 ms). File này không thuộc phạm vi 074c-3c-2a. Chạy riêng `test/visionMax.test.ts`: 9/9 đạt trong 1715 ms. Nguyên nhân chưa xác định: chưa đo được tải lúc đó nên không gắn lỗi với tải, và không tái hiện được ở lần 2. Vì vậy lần 1 không được tính là "0 lỗi".

Lần 2, không đổi code (log `scratchpad/server-full-3c2a-rerun.log`, EXIT 0): 285 file đạt, 4 bỏ qua (289); 2347 test đạt, 9 bỏ qua (2356); 0 lỗi. 12/12 test của `toolProposalDraftRoute.test.ts` có trong log và đều ✓.

Lần 3, trên cây hiện tại sau khi sửa báo cáo và hoàn nguyên (log `scratchpad/server-full-3c2a-run3.log`, lệnh `npx vitest run`, EXIT 0): 285 file đạt, 4 bỏ qua (289); 2347 test đạt, 9 bỏ qua (2356); 0 lỗi. Log này dùng reporter mặc định nên không liệt kê từng test; 12/12 test của `toolProposalDraftRoute.test.ts` được chạy riêng với `--reporter=verbose` trên cây hiện tại và đều ✓ (Tests 12 passed). Lần 3 là kết quả dùng để đóng lát (a) thay cho lần 2, vì mtime của `api/operator.ts` muộn hơn log lần 2.

Đối chiếu số đếm: test 2335 (lát 3c-1) + 12 (lát này) = 2347. File 284 (lát 3c-1) + 1 (file mới) = 285.

## Sai lệch có chủ đích so với spec handoff

- Spec handoff yêu cầu ánh xạ mã HTTP cho các kết quả không drafted. Lát này không làm: kết quả `skipped`, `refused`, `pending` trả HTTP 200 với body trạng thái (`status`, `reason`, `impNumber` nếu có). Chỉ lỗi runner (500), 400, 403, 503 là mã lỗi.
- Các test xác nhận 200 bằng `statusCode`: drafted (dòng 83), already_drafted (dòng 100), refused exists (dòng 126), refused bad_root (dòng 142), pending budget_limit (dòng 252).
- Hai kết quả không drafted không kiểm mã HTTP, chỉ kiểm body: not_accepted (dòng 111–112) và in_flight (dòng 167). Mã của hai trường hợp này chưa được khẳng định bằng test.

## Giới hạn đã biết (ghi nhận, chưa sửa)

1. Production trả 503 cho đến lát (b): chưa có runner thật và chưa có thư mục gốc được tiêm.
2. Lock trong tiến trình (in-flight guard) chỉ có hiệu lực trong một tiến trình. Hai tiến trình trên cùng DB không bị chặn.
3. Guard in-flight chưa có mutation ở mức route trong lát này. Test in_flight ở route (dòng 148) có, nhưng chưa chạy mutation bỏ guard trên route. Ở tầng đơn vị, guard có mutation đã đặt tên trong lát 3c-1, ghi ở `docs/tasks/TASK-074c-4b-3c-1.report.md` (mục Kiểm tra, M2 và M3 trên `proposalDraft.ts`): M2 bỏ guard, 1 đỏ ở "returns in_flight"; M3 giữ guard nhưng bỏ `running.delete(id)`, 3 đỏ. Đây là bộ mutation của 3c-1, không phải của lát này (bộ M1–M3 của lát này chỉ còn số đếm, xem mục Kết quả kiểm tra).
4. `bad_content` thử lại vẫn chi mỗi lần.
5. Dòng có file `IMP-<n>.md` mà không có marker vẫn là `refused exists` cho đến khi người dùng xoá file. Không có cơ chế nhận lại file.
6. Mồ côi file: nếu dòng rời `accepted` trong lúc runner chạy thì file đã ghi vẫn còn (giới hạn 6 của 4b-3b, chưa có test).
7. Migration 0100 chỉ được áp dụng cho DB `:memory:` của test, không áp cho DB thật hay bản sao.
8. Test symlink bị bỏ qua trên máy này (`proposalWriter.test.ts:104`).
9. Tsc không bao phủ thư mục `test/`.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Runner LLM thật và thư mục gốc `docs/proposals` (lát b). Các câu hỏi cho lát b (cắt ngắn đầu ra `finishReason: "length"`, số lần thử lại có tính thêm vào `llmCalls` không, đường chi thứ hai trong `generateRoutedStructured`) sẽ đưa lên advisor trước khi viết test đỏ của lát (b).
- Trang nhãn và danh sách accepted (lát c).
- Chuyển `accepted` → `in_progress`.
- Áp migration lên DB thật.
