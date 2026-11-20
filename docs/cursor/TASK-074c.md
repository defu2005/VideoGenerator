# TASK-074c — Yêu cầu cải tiến: gộp, mã nguồn mở, bản nháp guide, tự kiểm chứng 🧭

**Ai làm:** người thực hiện do người dùng giao (ROADMAP ghi Codex). Claude chỉ viết guide và review. **Cỡ:** M toàn bộ, chia năm phần. **Migration:** có, ở 074c-1 (drizzle-kit, không sửa tay).
**Cần trước:** xem mục "Phụ thuộc" bên dưới. Chưa có phần nào trong guide này được code.
**Nguồn:** `docs/cursor/TASK-074.md` §5 (dòng 206), §6 (dòng 243), §7 (dòng 256), checklist §10; `docs/cursor/TASK-074-estimate-2026-11-19.md` dòng 50–58 (bảng 074c-1…5).

## Phụ thuộc (mâu thuẫn đã ghi trong `GOAL-2026-11-18.decisions.md`)

- Estimate và README dòng 54t: 074c không phụ thuộc 088 hoặc 074b.
- ROADMAP dòng 71: phụ thuộc 074b. ROADMAP G3 (dòng 152): 092a → 093 → 094 → 074c.
- **Mặc định trong guide này:** theo estimate, không phụ thuộc. Nhưng 074c-1 chỉ được bắt đầu khi:
  1. `TASK-074b-4` đã có trong cây mã: `docs/tasks/TASK-074b-4.report.md` tồn tại và code 074b-4 đã được ghi (vì 074b đổi `operator/` mà 074c cũng chạm). Chưa cần review xong mới bắt đầu 074c-1, nhưng báo cáo 074c-1 phải ghi rõ là xếp chồng lên 074b-4 chưa review, và
  2. không có phiên ghi nào khác đang chạy trên `apps/server/src/operator/` hoặc `apps/server/drizzle/`.
- Nếu advisor chốt khác (ví dụ theo ROADMAP G3), sửa dòng này trước khi giao.

## Trạng thái mã hiện tại (đã đọc, 2026-11-20)

- **074c-1 đã code (2026-11-20), chưa review:** bảng `improvement_requests` (migration `0099_improvement_requests.sql`, sinh sau 0098), `propose_missing_tool` và ba hàm trong `toolProposals.ts` ghi và đọc bảng mới với `kind='tool'`, hàm sao chép `copyLegacyToolProposals` chạy trong `migrateDatabase`. Bảng cũ `operator_tool_proposals` còn nguyên. Báo cáo: `docs/tasks/TASK-074c-1.report.md`. Phần dưới mô tả trạng thái trước 074c-1.

- Bảng `operator_tool_proposals` (`apps/server/src/db/schema.ts:1280`): cột `id, kind, name, details (JSON), status, created_at`. Không có `fingerprint`, `weight`, `evidence`, `effort`, `risk`, `expected_impact`.
- `apps/server/src/operator/toolProposals.ts`:
  - `ToolProposalArgs` (dòng 9–24) có `kind: "internal" | "external_mcp"` (không phải `tool | feature | …`), `name`, `operation`, `reproduction`, `impact`, `inputSchema`, `outputSchema`, `permissions`, `dataSent`, `requiresConfirmation`, `acceptance` (≤ 6), `sourceUrl`.
  - `recordToolProposal` (dòng 26–50) dedupe theo `(kind, name)` khi còn `pending`; giới hạn cứng **10 dòng/24 giờ** tính trên mọi dòng (dòng 40–42), không đọc từ ngân sách.
  - `listToolProposals` lấy 50 dòng `pending`; `dismissToolProposal` đặt `dismissed`.
- Công cụ: `propose_missing_tool` ở `apps/server/src/assistant/tools.ts:1938`; quyền ở `apps/server/src/auth/toolActions.ts:57`; lease ở `apps/server/src/supervision/leases.ts:44`.
- `research-open-source` đã có: `apps/server/src/research/skills.ts:15`.
- Ngân sách: `apps/server/src/operator/autonomyBudget.ts` có `selfImprovement` theo workspace (khóa `selfImprovement.<ws>.settings`, `used.<ngày>`), ECO chặn `researchRuns` và `skillDrafts`. Bộ đếm `improvementRequests` **đã có** trong `packages/shared/src/selfImprovement/schema.ts:7` (mặc định 10), cùng `behaviourEvals`. `toolProposals.ts` chưa đọc bộ đếm này; 074c-2 phải nối vào. Không thêm bộ đếm mới.
- `apps/server/src/operator/writeGuard.ts` là chụp và khôi phục mọi file ngoài `notes/` cho lượt chạy agent. **Không dùng và không mở rộng** cho bộ ghi của 074c-4.
- Migration mới nhất: `apps/server/drizzle/0098_operator_skill_shadow_runs.sql` (của 074b-3a, chưa review). Số migration của 074c-1 do `drizzle-kit generate` sinh ngay sau 0098. Nếu 0098 đổi khi review, sinh lại migration của 074c-1; không đoán số trước.

## Người gọi `operator_tool_proposals` (phải giữ hành vi sau 074c-1)

Đã grep `apps/server/src apps/server/test apps/web/src apps/mcp/src` (2026-11-20):

- Lõi: `apps/server/src/operator/toolProposals.ts` (`recordToolProposal`, `listToolProposals`, `dismissToolProposal`); bảng `apps/server/src/db/schema.ts:1280-1288`.
- API: `apps/server/src/api/operator.ts:12,66,110-112` (GET `/api/operator/tool-proposals`, POST `.../:id/dismiss`). Từ 074c-6k, dismiss chỉ dành cho người dùng đăng nhập, như accept, start, check-done và draft.
- Báo cáo operator: `apps/server/src/operator/service.ts:34,850` (ảnh chụp `toolProposals` cho trang); `service.ts:155` và `operator/hooks.ts:31` (`notifyToolProposal`).
- Công cụ: `apps/server/src/assistant/tools.ts:81,1941-1946` (`propose_missing_tool`).
- Web: `apps/web/src/features/operator/ToolProposals.tsx` (đọc API), `OperatorPage.tsx:15,196`, `SkillVersions.tsx:34,153,159` (đếm đề xuất chờ xử lý).
- MCP: `apps/mcp/src/tools.ts:66` (quy tắc đường dẫn cho GET/POST).
- Test: `apps/server/test/operator.test.ts`, `apps/server/test/registry.test.ts`, `apps/web/src/features/operator/SkillVersions.shadow.test.tsx`.

Sau 074c-1, mọi chỗ trên đọc và ghi qua `improvement_requests` với `kind='tool'`. Hình dạng API giữ nguyên: `open` hiển thị như `pending`, `rejected` như `dismissed`. Giới hạn 10 dòng/24 giờ vẫn hard-code đến 074c-2.

## Phạm vi

Bổ sung các phần còn thiếu của §5–§7 spec 074, theo năm phần trong estimate:

- **074c-1 — bảng `improvement_requests` (migration).**
  - Tạo bảng mới `improvement_requests` theo cột của `ImprovementRequest` (§5), gồm `fingerprint`, `weight`, `status` (bảy giá trị của spec), `evidence` (JSON).
  - Sao chép dữ liệu từ `operator_tool_proposals` **bằng code** trong một hàm migrate idempotent: khóa theo `id` cũ bằng `INSERT OR IGNORE`, chạy hai lần không thêm dòng; `kind` cũ `internal`/`external_mcp` thành `tool`; `details` giữ nguyên trong `evidence`/`proposal`; `status` cũ `pending` thành `open`, `dismissed` thành `rejected`. Không xóa, không đổi bảng cũ.
  - Migration sinh bằng `drizzle-kit generate` và chỉ được chứa bảng `improvement_requests`. Nếu SQL sinh ra có thứ khác, `schema.ts` đã lệch khỏi snapshot: dừng và báo, không sửa tay.
  - `propose_missing_tool` giữ nguyên tên và tham số, ghi `kind: tool` vào bảng mới. Các hàm `recordToolProposal`, `listToolProposals`, `dismissToolProposal` và các người gọi trong mục "Người gọi" chuyển sang bảng mới, giữ hình dạng trả về. Các test hiện có của nó phải vẫn xanh.
  - Kiểm migration trên **bản sao** của `data-dev/app.db` (không trên `data/app.db`). Nếu `operator_tool_proposals` có 0 dòng thì ghi rõ: logic sao chép chỉ được chứng minh bằng test gieo dữ liệu.
- **074c-2 — gộp theo `fingerprint`, giới hạn và xếp hạng.**
  - Cùng `fingerprint` thì cộng `evidence` và `weight`, không thêm dòng.
  - Đã kiểm 2026-11-20: ngoài test, không có đường nào đọc `weight` (`rankImprovements`, `selectWeeklyDigest`, `scoreImprovement` chỉ được test import). Vẫn không trần, ghi là giới hạn đã biết; quyết định khi gắn digest hoặc xếp hạng cho người dùng.
  - Ghi chú của advisor (2026-11-20, review `TASK-074c-2.review.md`): hiện không có trần hay quy tắc evidence khác nhau cho `weight`. Phải quyết định một trong hai trước khi bất kỳ thứ gì đọc `weight` (digest, xếp hạng cho người dùng). Yêu cầu `rejected` nằm ngoài tập gộp, nên lần gọi sau mở dòng mới; đây là hành vi hiện tại, không đổi.
  - Giới hạn 10 yêu cầu mới/ngày đọc từ bộ đếm `improvementRequests` trong ngân sách (thêm bộ đếm nếu chưa có), không hard-code.
  - Xếp hạng: `weight × expectedImpact ÷ effort` (`S=1, M=2, L=3`). Digest tuần tối đa 3 mục.
  - Trước khi đề xuất `tool`/`feature`/`data_source`, chạy `find_tools` và `find_skills`. Nếu có skill làm được việc thì tạo bản nháp skill (§4), không tạo yêu cầu.
- **074c-3 — `openSource` cho M/L.** Gọi `research-open-source` trong ngân sách research (dùng bộ đếm `researchRuns` có sẵn). Nếu hết ngân sách thì để `openSource` rỗng và đánh dấu `openSourcePending: true`.
- **074c-4 — bản nháp guide.**
  - Khi chấp nhận, một lần gọi LLM ghi `docs/proposals/IMP-<n>.md` theo mẫu `docs/cursor/TASK-*.md` (phạm vi, mã nguồn mở, dữ liệu và code, bước, test, checklist).
  - Ghi qua **bộ ghi hẹp mới** chỉ được ghi trong `docs/proposals/` (đường dẫn tuyệt đối đã chuẩn hóa, từ chối `..` và symlink). Không mở rộng `writeGuard.ts`.
  - Trang hiển thị "Bản nháp guide — cần Claude xem lại trước khi giao Codex/Cursor".
  - Operator không sửa mã nguồn app, không chạy git, không khởi động Codex/Cursor trên repo.
- **074c-5 — xác minh.**
  - Khi trạng thái chuyển sang `in_progress` và có `docs/tasks/<TASK>.done` cho task người dùng gắn, đọc các mục `acceptance` có thể kiểm bằng công cụ đọc.
  - So `expectedImpact.metric` sau 14 và 28 ngày với trước đó. Kết quả là `verified` hoặc `failed_verification`, kèm số.
  - Tự hiệu chỉnh: nếu tỉ lệ được chấp nhận dưới 30% trong 20 yêu cầu gần nhất thì giảm nửa hạn mức ngày, cho đến khi tỉ lệ phục hồi. Hiển thị tỉ lệ trên trang.

## Ngoài phạm vi (không làm trong 074c)

- Trang web "Tự cải tiến" và tab Research/Skill/Outcome đầy đủ: phần web của §7, làm sau khi server có dữ liệu.
- Digest tuần và bảng "được làm / không được làm" trong hướng dẫn người dùng (§7): làm sau 074c-2.
- Mở rộng `writeGuard.ts`; tăng ngân sách bằng code; để operator tự sửa `apps/server/src`.
- `propose_missing_tool` đổi tên hoặc đổi tham số.

## Quy tắc cứng

- Ngân sách `selfImprovement` không do operator tăng. Người dùng mới đổi được.
- Mọi yêu cầu có `evidence` (loại, ref, ghi chú). Không có bằng chứng thì không ghi.
- Chạy `containsProtectedProject` và `redactExportText` như `toolProposals.ts` hiện làm cho mọi trường văn bản mới.
- Không đụng `data/` và dự án `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Dữ liệu và code

- **Dữ liệu:** một bảng `improvement_requests`, một trường `evidence` JSON. Bộ đếm theo ngày dùng `used.<ngày>` của ngân sách `selfImprovement` đã có; không tạo khóa mới.
- **Code:** logic gộp, xếp hạng, bộ ghi hẹp, hàm migrate sao chép.

## Mã nguồn mở có sẵn (open source)

- Dùng `research-open-source` (đã có, `research/skills.ts:15`) cho `openSource` của yêu cầu M/L. Không thêm thư viện mới cho 074c.
- Cần thêm: không có. Nếu người thực hiện thấy cần thư viện, dừng và hỏi.

## Bước

1. Kiểm phụ thuộc: `docs/tasks/TASK-074b-4.report.md` có mặt và code 074b-4 có trong cây mã; không có phiên ghi nào khác trên `operator/` hoặc `drizzle/` (xem `GOAL-2026-11-18.decisions.md`). Nếu không đạt thì dừng ở đây và báo.
2. 074c-1: viết test sao chép trước (chạy đỏ), rồi migration (drizzle-kit), rồi hàm sao chép, rồi đổi `propose_missing_tool`. Chạy migration trên bản sao dev DB. Ghi số lượng dòng trước và sau.
3. 074c-2: test gộp, test giới hạn đọc từ ngân sách, test xếp hạng, test digest ≤ 3 mục.
4. 074c-3: test khi hết ngân sách (`openSourcePending`).
5. 074c-4: test bộ ghi hẹp (từ chối ra ngoài `docs/proposals/`, từ chối `..`, từ chối symlink); test trang hiển thị nhãn "Bản nháp guide".
6. 074c-5: test chuyển trạng thái theo `.done` và công thức hiệu chỉnh 30%.
7. Chạy:
   - `apps/server`: `npx tsc -p tsconfig.json --noEmit`; `npx vitest run test/operator.test.ts test/registry.test.ts test/budget.test.ts test/autonomy.test.ts test/autonomyGates.test.ts test/selfImprovementBudget.test.ts test/budgetNeedsUserEvents.test.ts` và các test mới của 074c (đặt tên khi viết test, ví dụ `test/operatorImprovementRequests*.test.ts`).
   - `apps/web`: tsc và `npx vitest run src/features/operator/SkillVersions.shadow.test.tsx` cùng test của trang nếu có thay đổi web.
8. Báo cáo `docs/tasks/TASK-074c-<phần>.report.md`. Không ghi `.done` cho mã của chính mình; Claude hoặc người review sẽ ghi sau khi review.

## Xong khi

- Năm phần có báo cáo; test mới đỏ trước rồi xanh; `propose_missing_tool` cũ không hỏng; migration chạy được trên bản sao; bộ ghi hẹp không ghi ngoài `docs/proposals/`.
- Báo cáo ghi rõ số migration, số dòng sao chép và phần chưa kiểm chứng trên dữ liệu thật (đặc biệt 074c-5 cần 14 và 28 ngày dữ liệu).

## Checklist

- [ ] Phụ thuộc đã kiểm (bước 1)
- [ ] Migration sinh bằng drizzle-kit sau 0098; sinh lại nếu 0098 đổi khi review
- [ ] Test trước khi code, đều đỏ trước
- [ ] `writeGuard.ts` không đổi
- [ ] Ngân sách không do operator tăng
- [ ] Không đụng `data/` hoặc dự án được bảo vệ
- [ ] Báo cáo không có `.done`
