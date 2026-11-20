# TASK-145 — Review chính thức, 2026-11-18

**Verdict: chưa chấp nhận.** Migration 0087 đã được kiểm riêng là additive `script_drafts`, FK cascade; Drizzle canonical báo No schema changes. Không cho phép chỉnh lại migration này. Không commit/push.

## Findings

### [P1] Chấm lại tin tổng điểm LLM và bỏ qua job/usage accounting

`services/scriptService.ts::rescoreCritique` dùng trực tiếp `evaluated.value.total`, không gọi `computeScriptCritique`. Tái hiện offline bằng `npx tsx tmp/codex-review-145-rescore.ts`: mock trả scores structure/hook/tts/visual/originality=0, accuracy=3, total=100. Tổng đúng theo code phải là12, nhưng DB lưu `quality_score:10`, `blocking_facts:0`; một lời gọi model và **không có job mới**. Log `tmp/codex-review-145-rescore.log`.

Guide cấm tin tổng do model tính. Cả rescore/hook switch đang generate trực tiếp từ service mà không có job/usage record tương ứng; lỗi/call sửa cũng phải được tính. Hook switch/rescore còn đọc script trước await rồi ghi sau await không CAS version/input hash, có thể ghi đè hoặc chấm điểm nhầm bản USER vừa sửa. Cần dùng đường job/fence/accounting hiện có và kiểm phiên bản trước ghi, không tạo hệ thống quality/job khác.

### [P1] Targeted rewrite không giữ phần ngoài phạm vi

`storyEngine.ts` tạo failingSectionIds nhưng merge mọi section model trả về, kể cả id không thuộc failing set. Hook/outro model trả cũng được nhận vô điều kiện. `ScriptService.switchHook` nhận toàn bộ revisedSectionNarration thay vì chỉ thay câu mở đầu; phần còn lại section1 cũng có thể bị viết lại. Prompt không phải hàng rào bảo toàn dữ liệu. Phải thực thi allowlist trong code, giữ byte-identical phần không được phép và mọi câu sau câu đầu khi đổi hook. Thêm mock cố tình trả phần tốt đã sửa để test sự từ chối.

### [P2] Vòng sửa và ngân sách không khớp hướng dẫn/thực thi

- Điều kiện stop hiện là gain<3 **và** nextTotal<=prevTotal; gain1 hoặc2 vẫn gọi vòng tiếp, trái yêu cầu dừng khi tăng dưới3.
- Full có outline+hook critic+narration+initial critic+hai rewrite+hai re-critic+length fit =9 lời gọi thành công, chưa repair/fallback; estimate ghi max7, số critic max3 thay vì4. Lite cũng có thể6 trước các repair. Không được dùng con số thấp chỉ để khớp một dòng guide mâu thuẫn; phải lập ngân sách trung thực cho thuật toán đã yêu cầu và ghi rõ cách hiểu.
- Outline có structured repair rồi thêm semantic repair; các thất bại bị catch mà không cộng error.usage. Cần trần retry thống nhất và tính đủ mọi attempted call.

### [P2] Metadata và trạng thái critique chưa được ràng buộc

- Writer được yêu cầu copy beat metadata bằng prompt nhưng code không thực thi mapping beat/section, không bảo đảm section order/factIds/loops còn đúng sau narration/length fit.
- Hook history đọc `chosenId`, trong khi executor/service lưu `chosenHookId`; tie breaker lịch sử không có dữ liệu đúng.
- USER script luôn critiqueStale do origin USER/edited kể cả vừa rescore; bản rescore cho old script tạo draft outlineNULL, nhưng GET chỉ trả draft khi outline có giá trị. Cần fingerprint nội dung được chấm, không chỉ origin/timestamps.
- Khi rescore, blocking_facts đang bị gán lại từ một điểm accuracy; không được xóa blocking fact check có sẵn. Prompt rescore nói7 chiều trong khi schema/rubric là6 và chỉ gửi researchSummary thay vì facts có ids.

### [P2] Benchmark và bộ test chưa đủ nghiệm thu

CLI `benchScript.ts` chưa đáp ứng benchmark được giao: baseline cost gán0, fallback engine score gán50, baseline total tính đều6 tiêu chí thay vì trọng số, không xuất means/cost từng variant, judge dùng cùng scriptCritic route và không cấu hình route thứ ba độc lập. CLI mở DATABASE_PATH từ parseConfig thay vì một runner dev/fixture rõ ràng; tuyệt đối không chạy nó trong tests hoặc vô tình vào dữ liệu thật. Không có bằng chứng modelEval suite registration chạy đủ10 fixtures, không chỉ export một array.

Chỉ3 storyEngine tests không chứng minh các ca explicit của guide (outline invalid→one repair→fallback, adversarial rewrite, stop gain1/2, all mode counters, length fit revert, hold55/accuracy2, snapshot/invalidation, paid tool/API fencing, old-script plan/render). Cần bổ sung kiểm chứng những yêu cầu này; không thay assertion cũ cho dễ pass. Report có đường dẫn `shared/src/llm/tasks.ts` không khớp source thật, cần sửa file list và số task chính xác.

## Kiểm chứng

- Đã đọc guide, report, engine, service, schemas/budget/call estimates, CLI và test source. Không gọi LLM thật hay chạy benchmark thật.
- Supervisor typecheck và build toàn repo đạt, logs `tmp/codex-supervisor-round2-typecheck.log` / `...-build.log` (Vite cảnh báo chunk lớn).
- `npx drizzle-kit generate` trong apps/server: No schema changes, `tmp/codex-supervisor-round2-drizzle.log`.
- Repro mock của rescore chứng minh scores/total/accounting chưa đúng; bộ focused hiện đang được kiểm lại riêng. Không dùng test green để bác finding có trigger cụ thể trên.
- Không dependency mới trong lockfile; package server chỉ thêm script benchmark được guide cho phép. Docs/featureMap/skills có nhưng cần phản ánh hành vi đúng sau sửa.

Giao fix1 cho opencode; giới hạn script/service/shared budget/benchmark/tests, không sửa continuity, GC/preview, stage-adapter framework hay db/schema/migrations. Review lại trước khi giao146 hoặc147d; chỉ migration0087 được công nhận đã vào journal đúng hình thức.

Small review fix của Codex: bộ agent/visual gồm13file đạt143/144, lỗi duy nhất là hai tool mới chưa có RESOURCE_MAP. Đã thêm `switch_script_hook` và `rescore_script` vào project lease trong `supervision/leases.ts` (một dòng cấu hình); không sửa assertion. Test supervision được kiểm lại riêng. Các finding lớn phía trên vẫn giao worker xử lý.

Regression supervisor tiếp theo: shared781/MCP49 đạt; web228 đạt/3 lỗi tại PipelinePanel budget estimate, ProjectDetailPage overview, CreateProjectDialog budget preview (`tmp/codex-supervisor-round2-other-workspaces.log`). Server log `tmp/codex-supervisor-round2-server.log` đang có lỗi budget/API legacy research mode/checkpoint và skill coverage; cần phân loại khi kết thúc. Không tuyên bố web/server toàn bộ đạt từ các test panel tập trung.

## Sự kiện fix1 — 2026-11-18: phiên bị ngắt, chưa nghiệm thu

Đã đọc event a25ee54d-fc56-4b94-8b4e-29603cd8ea3a: PID36616 exit1, FreshReport:false, FreshMarker:false, ReadyForReview:false. PID không còn tồn tại; TASK-145.fix1.report.md và TASK-145.fix1.done đều thiếu. Log tmp/opencode-task145-fix1.log kết thúc bằng Error: Invalid token (request id202611171813427599248318268d9d6gj4qDkAs). Đây là lỗi token/provider của phiên, khác lỗi native stderr wrapper ở141/143. Không đọc/chỉnh credential, không tự retry hay đổi model/auth.

Log cho thấy có làm dở các thay đổi stop gain, rescore/version fence/accounting và UI draft; đã kiểm trạng thái/diff thống kê các vùng script. Các patch hiện có được giữ nguyên, không revert, không coi marker/report TASK-145 cũ là kết quả fix1. Không có report hoặc bằng chứng chạy đủ tests/typecheck/build của bản sửa hoàn tất; chưa kết luận các finding ban đầu đã được giải quyết. Có lần chạy repro gặp transform error giữa phiên; các lần gọi repro khác không đủ thay cho validation checklist. Verdict vẫn NOT ACCEPTED, fix1 INCOMPLETE, cần review lại phần dở khi người dùng cho tiếp tục.

Theo yêu cầu người dùng: không dispatch thêm task/fix/retry/replacement, không commit/push/promote. Goal PAUSED. Process inventory tại lượt callback không có opencode-cli run nào còn sống; đã kết thúc các lượt callback hiện tại và chờ người dùng. Không polling hoặc vòng goal continuation.
