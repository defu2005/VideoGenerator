# TASK-074c-3c-2b — runner thật và nối production cho route soạn bản nháp (lát b) (báo cáo)

Trạng thái: runner LLM thật và wiring production đã có trong cây làm việc; đường dẫn gốc `<repo>/docs/proposals` được nối vào production, nhưng thư mục đó không được tạo (đã kiểm: không tồn tại; không có ghi vào thư mục thật). Rà soát đóng lát dựa trên bằng chứng trong transcript và văn bản báo cáo, không phải kiểm toán độc lập mã nguồn. Cây git: các file của lát này và các lát 074c trước đều chưa commit (untracked), và cây đã có nhiều thay đổi chưa commit trước khi bắt đầu, nên `git status` không cô lập được diff của riêng lát này. Chưa commit, chưa push, chưa có `.done`. Không ghi vào `data/`, `data-dev/` hay `docs/proposals/` thật; không áp migration 0100 lên DB thật hay bản sao; không khởi động app; không chuyển `accepted` → `in_progress`; không nối research-runner.

## Đã làm

- `apps/server/src/operator/proposalRunner.ts` (mới): `createProposalRunner({ registry, sqlite }): DraftRunner`.
  - `resolveTask("operatorPlan", …)` rồi `generateRoutedStructured` với schema `ProposalDraft` `{ markdown: string }` (strict, min 1), `maxOutputTokens: 4096`, `repairAttempts: 0`, timeout 120 s, `cache: new LlmCache(sqlite, false)`.
  - Trả về `markdown`. Lỗi đi ra nguyên trạng (xem Giới hạn 1 và 3).
  - Cổng chi tiêu autonomy nằm bên trong `generateRoutedStructured`; điều kiện đầy đủ xem Giới hạn 1.
- `apps/server/src/operator/proposalWiring.ts` (mới):
  - `resolveProposalDraft(option, makeRunner)`: không có option → `undefined` (route trả 503). Có runner → trả **đúng object của caller** (xem mục Lỗi đã sửa). Không có runner → gọi factory đúng một lần.
  - `ensureProposalRoot(root)`: `mkdirSync` chỉ leaf, không tạo chuỗi thư mục cha; lỗi bị nuốt, quyết định cuối thuộc về kiểm tra đích.
- `apps/server/src/operator/proposalDraft.ts`: thêm tuỳ chọn `ensureRoot?`. Gọi sau `assignImpNumber`, trước `checkProposalTarget`; lỗi bị nuốt có chủ đích.
- `apps/server/src/app.ts`: `buildApp({ …, proposalDraft?: ProposalDraftOption })`; route nhận `resolveProposalDraft(proposalDraft, () => createProposalRunner({ registry: llmProviders, sqlite: database.sqlite }))`.
- `apps/server/src/index.ts`: `buildApp({ config, proposalDraft: { root: join(repoRoot(), "docs", "proposals"), ensureRoot: ensureProposalRoot } })`.
- `apps/server/test/toolProposalDraftRoute.test.ts`: tripwire đổi từ kiểm tra vắng mặt sang snapshot. Ghi danh sách `docs/proposals` trước và sau, có neo dương (`apps/server/package.json` tồn tại dưới `repoRoot()`).

## Lỗi đã sửa trong lát này

- Wiring đầu tiên sao chép `root` và `runner` lúc `buildApp`. `toolProposalDraftRoute.test.ts` đổi `draft.root` và `draft.runner` trong `beforeEach` và dựa vào việc route đọc dependency lúc request, nên 6 test đỏ (`bad_root` thay vì `pending` / 500 / 200).
- Sửa: viết test đỏ trước (`proposalWiring.test.ts`, "a caller-supplied runner returns the same object…"), sau đó `resolveProposalDraft` trả lại object của caller khi có runner. Handler `operator.ts` truyền thẳng `proposalDraft` vào `draftProposal` lúc request nên không cần đổi handler.
- Kết quả: test identity đỏ đúng hành vi trước sửa; sau sửa `proposalWiring.test.ts` 7/7 và `toolProposalDraftRoute.test.ts` 12/12.

## Kiểm tra

- `npx tsc --noEmit` trong `apps/server`: EXIT 0.
- Red-first theo từng file (ghi đúng lịch sử):
  - `proposalWiring.test.ts`: 6 test đỏ vì thiếu module/helper (lỗi import) trước khi viết code; test identity đỏ đúng hành vi (`root: "/first"` nhận được) trước khi sửa.
  - `proposalDraftRoot.test.ts`: trước khi thêm lời gọi hook, 2/4 đỏ đúng hành vi (test "creates a missing leaf…" và "an ensureRoot that throws…"); sau khi thêm, 4/4 xanh.
  - `proposalRunner.test.ts`: không ghi lượt đỏ riêng cho file này. Bằng chứng là mutation bỏ `repairAttempts: 0` làm test "non-JSON" đỏ (xem dưới).
  - `toolProposalDraftRoute.test.ts`: 6 đỏ do regression wiring (đã nêu), sau sửa 12/12.
- Chạy sau khi đổi tripwire: `toolProposalDraftRoute.test.ts` 12/12 xanh (22.82 s, EXIT 0). Snapshot `docs/proposals` không đổi.
- Nhóm 7 file liên quan (`proposalRunner` 3, `proposalWiring` 7, `proposalDraftRoot` 4, `toolProposalDraftRoute` 12, `proposalDraft` 17, `toolProposalAccept` 13, `toolProposalAcceptedList` 7 = 63) xanh trước khi đổi tripwire. Số liệu này được thay bằng lần full suite bên dưới.
- Kiểm tra không ai truyền `proposalDraft` mà thiếu runner: chỉ `toolProposalDraftRoute.test.ts` truyền option, và luôn kèm runner. Mọi `buildApp` khác không có option nên route trả 503. Không test nào chạm runner mặc định (có khoá OpenAI giả trong cấu hình test).

### Mutation (mỗi mutation khôi phục từ bản sao, kiểm bằng `diff`)

- M1 bỏ lời gọi `ensureRoot` trong `runDraft`: 2 đỏ (test "creates a missing leaf…" và "an ensureRoot that throws…"). Khôi phục: khớp.
- M2 luôn gọi factory dù đã có runner (dòng `makeRunner();` chèn trước `if (hasRunner(option))`): 2 đỏ — `a given runner is kept…factory is not called` (đỏ vì factory được gọi khi đã có runner) và `a missing runner calls the factory exactly once` (đỏ vì nhánh thiếu runner gọi factory hai lần dưới mutation). Tên đối chiếu với đầu ra mutation trong transcript. Khôi phục: khớp.
- M3 trả bản sao thay vì object của caller: 8 đỏ = 2 trong `proposalWiring.test.ts` (test identity; và "keeps an injected ensureRoot hook", đỏ vì bản sao làm mất `ensureRoot`, không phải vì identity) + 6 trong `toolProposalDraftRoute.test.ts`. Khôi phục: khớp.
- Mutation bỏ `repairAttempts: 0` (`proposalRunner.ts`): test "non-JSON" đỏ, khôi phục khớp. Đây là bằng chứng cho `proposalRunner.test.ts`.

## Full suite

Lần 1 (`bijnpbwk2`, cây cuối, log `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\server-full-3c2b-final.log`; SUITE_EXIT=1):
- Test Files: 3 failed | 285 passed | 4 skipped (292).
- Tests: 4 failed | 2357 passed | 9 skipped (2370). Thời gian 369 s.
- Đối chiếu: 288 file và 2361 test không bỏ qua, khớp baseline (285/4, 2347/9) cộng 3 file và 14 test mới.
- 4 test đỏ, đọc từ log: `render.test.ts` (1, ffmpeg thật), `visionMax.test.ts` (2), `visionSchemaFix.test.ts` (1). Cả 4 đều có `Test timed out` (60 s cho render, 30 s cho ba test vision). Ngoài ra `render.test.ts` còn lỗi `EPERM` khi dọn thư mục tạm trong `test/pipelineFixtures.ts:99` (`rmSync`), xảy ra sau khi test đã timeout; chưa kiểm chứng nguyên nhân (có thể tiến trình ffmpeg còn giữ file). Không có lỗi khẳng định nào.
- Chạy riêng ba file này (log `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\three-files-alone.log`, exit 0): 3/3 file, 34/34 test xanh. Đây không phải lần chạy full suite, và chưa kết luận gì về nguyên nhân timeout khi chạy song song.
- `visionMax.test.ts` và `visionSchemaFix.test.ts` import `buildApp` từ `app.ts` (đã thêm tùy chọn `proposalDraft`) nhưng không truyền tùy chọn đó, nên không chạm đường soạn bản nháp. `render.test.ts` không import code của lát này. Theo ghi chú phiên trước, `visionMax` cũng từng timeout khi chạy full suite; chưa có log baseline để đối chiếu xem có cùng lỗi trước lát này không.
- Các process `node.exe` đang chạy trên máy (MCP server, desktop-commander, omniroute, playwright, reqwise-figma) không phải tiến trình vitest của phiên này; không dừng chúng.

Lần 2 (cây cuối, chạy full lại không đổi mã hay cấu hình; log `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\server-full-3c2b-rerun.log`; SUITE_EXIT=0):
- Test Files: 288 passed | 4 skipped (292).
- Tests: 2361 passed | 9 skipped (2370). Thời gian 284.6 s.
- Không có test đỏ. Đây là lần chạy dùng làm căn cứ đóng lát.

Kết luận: lần 1 có 4 test timeout trong ba file (xem trên); lần 2 trên cùng cây không tái hiện. Chưa xác định nguyên nhân timeout lần 1 (có thể tải song song); không ghi là "không liên quan" vì không có bằng chứng baseline.

Ghi chú về lần chạy:
- Lần chạy nền `bhsuwa217` chạy trên cây trước khi đổi tripwire; đã dừng bằng TaskStop, kết quả bị bỏ, không dùng làm số liệu.
- `scratchpad/full-suite.log` (66 byte, chỉ có dòng RUN) không phải là một lần chạy; không dùng làm bằng chứng.

## Giới hạn đã biết (ghi nhận, chưa sửa)

1. **Chi tiêu và cổng autonomy (đã đọc code; chưa truy vết end-to-end, chưa có test cho đường này).** `runDraft` trừ 1 `llmCalls` (`proposalDraft.ts:70`) TRƯỚC khi gọi runner; không có kiểm tra trước riêng. Nếu `llmCalls` đã hết, `SELF_IMPROVEMENT_BUDGET_LIMIT` → `pending`, runner không được gọi.
   - Cổng autonomy: `beforeProviderCall` (`providers/llm/structured.ts:397-403`) ném `LlmError` `AUTONOMY_BUDGET_WAIT` (retryable, có `retryAt`) trước lượt gọi nhà cung cấp, chỉ khi cả bốn điều kiện đúng: có hạn mức chi (`hasAutonomySpendLimit`), cache có sqlite (`:337`), mức tự chủ là supervised hoặc autonomous (`:342-343`), và trạng thái ngân sách là `stop` với nhà cung cấp tính phí theo lượt (không nằm trong `unmeteredProviders`, không phải `free_tier` hoặc `subscription`; `:398-401`).
   - `:345` trả về promise từ `runWithAutonomyBudget` không kèm `await`, nên lỗi từ chuỗi không rơi vào `catch` ở `:346-347`; lỗi đi thẳng ra ngoài `generateRoutedStructured`.
   - Trong vòng chuỗi của `routeStructured`, lỗi này được ghi nhận (`budgetWait`, `:673`) và chuỗi tiếp tục: nếu bước đó là primary gốc, có gateway trực tiếp, và chưa có lượt gọi nào trước đó, gateway trực tiếp được thử (`:674`); nếu một bước sau thành công, lượt trả về thành công (`:669-670`, `return` trước `:739`). Chỉ khi không bước nào thành công, `:739` mới ném lại `AUTONOMY_BUDGET_WAIT`.
   - Khi lỗi được ném lại: `runDraft` không bắt (chỉ bắt `SELF_IMPROVEMENT_BUDGET_LIMIT`), nên route trả 500 `INTERNAL_ERROR` (`app.ts:1189-1194`). Dòng giữ `accepted`, `drafted_at` NULL, và 1 `llmCalls` đã bị trừ.
   - Khi một bước dự phòng không bị chặn thành công: bản nháp được ghi như bình thường. Đường này chưa được truy vết end-to-end và không có test.
2. Các lượt gọi thêm trong `routeStructured` (failover chuỗi, gateway trực tiếp, quota-swap) không được tính vào `llmCalls`.
3. `LlmError` không phải `AppError`, nên Fastify trả 500 `INTERNAL_ERROR` với thông báo chung. Lát c không đọc được lý do từ phản hồi; cần map riêng nếu muốn hiển thị "chờ kỳ ngân sách". ĐÃ XỬ LÝ ở lát server 074c-3c-2b: xem `docs/tasks/TASK-074c-3c-2b-server.report.md` (429 cho chờ ngân sách, 502 cho LLM lỗi khác; lỗi thường vẫn 500).
4. Ghi dùng của runner không vào sổ ledger của operator.
5. Timeout (120 s) và cache không có test pin riêng.
6. `index.ts` và nhánh factory trong `app.ts` (`resolveProposalDraft(…, () => createProposalRunner(…))`) chỉ được kiểm bằng `tsc`; không có test nào truyền option thiếu runner, và không có test chạy khởi động.
7. `ensureRoot` nuốt lỗi; quyết định cuối thuộc về kiểm tra đích (`bad_root` hoặc `ok`). `ensureProposalRoot` không tạo thư mục cha: nếu `docs/` không tồn tại, kết quả là `bad_root` không chi tiêu.
8. `bad_content` (nội dung rỗng hoặc vượt `MAX_DRAFT_BYTES`) xảy ra sau khi đã chi tiêu.
9. File mồ côi: nếu dòng rời `accepted` trong lúc runner chạy, file đã ghi vẫn còn (giới hạn 6 của 4b-3b, chưa có test).
10. Lock in-flight chỉ có hiệu lực trong một tiến trình.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Chuyển `accepted` → `in_progress`; nối research-runner.
- Áp migration lên DB thật hoặc bản sao.
- Khởi động app.
- Trang nhãn "Bản nháp guide — cần Claude xem lại trước khi giao Codex/Cursor" và danh sách accepted (lát c).
