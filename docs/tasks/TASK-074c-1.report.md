# TASK-074c-1 — báo cáo: `improvement_requests` và chép đề xuất công cụ cũ

**Trạng thái:** đã code và chạy test. **Chưa được review.** Không có `.done`. Không commit, không push.
**Guide:** `docs/cursor/TASK-074c.md` (bước 074c-1).
**Migration:** `0099_improvement_requests` (sau `0098`).

## Phạm vi đã làm

- Thêm bảng `improvement_requests` (schema trong `apps/server/src/db/schema.ts`, khoảng dòng 1290). Bảng cũ `operator_tool_proposals` **không đổi, không xóa**.
- Migration do drizzle-kit sinh (`npx drizzle-kit generate --name improvement_requests`), không viết tay. File `apps/server/drizzle/0099_improvement_requests.sql` chỉ có `CREATE TABLE improvement_requests` và hai index. Journal và snapshot `0099` được cập nhật tương ứng.
- `apps/server/src/operator/toolProposals.ts` viết lại để ghi, đọc, bỏ qua đề xuất công cụ trên `improvement_requests` (`kind = 'tool'`):
  - `recordToolProposal`: cùng kiểm tra đầu vào và mã lỗi như trước. Trong một transaction `immediate`: trùng lặp (fingerprint `tool:<kind>:<name>`, trạng thái `open`) trả `duplicate`; giới hạn 10 đề xuất / 24 giờ (đếm mọi trạng thái) trả 429 `TOOL_PROPOSAL_LIMIT`. **Đã bị thay bởi 074c-2:** giới hạn nay là bộ đếm ngân sách `improvementRequests` theo ngày ICT, chỉ đếm yêu cầu mới. Gộp trùng cũng mở rộng từ `open` sang `open`, `accepted`, `in_progress`; xem `TASK-074c-2.report.md`.
  - `listToolProposals`: chỉ dòng `kind = 'tool'` và `status = 'open'`, tối đa 50.
  - `dismissToolProposal`: chỉ đổi dòng `kind = 'tool'` sang `rejected`.
  - `copyLegacyToolProposals`: chép idempotent từ `operator_tool_proposals` (`INSERT OR IGNORE`, khóa là id cũ). `pending` → `open`, `dismissed` → `rejected`, trạng thái khác bị bỏ qua. Dòng `details` không parse được hoặc không qua `ToolProposalArgs` cũng bị bỏ qua và đếm trong `skipped`.
- `apps/server/src/db/migrate.ts`: sau `backfillWorkspaceKeys`, gọi `copyLegacyToolProposals`. Nếu có dòng bị bỏ qua, ghi cảnh báo mỗi lần khởi động.
- Fingerprint giữ `kind` gốc (`internal` / `external_mcp`), nên đề xuất nội bộ và bên ngoài cùng tên vẫn thành hai dòng.

## File đã đổi

- `apps/server/src/db/schema.ts` (thêm bảng `improvementRequests`)
- `apps/server/drizzle/0099_improvement_requests.sql` (mới, sinh tự động)
- `apps/server/drizzle/meta/_journal.json` (thêm entry 99), `apps/server/drizzle/meta/0099_snapshot.json` (mới)
- `apps/server/src/operator/toolProposals.ts` (viết lại)
- `apps/server/src/db/migrate.ts` (import và gọi bước chép)
- `apps/server/test/improvementRequests.test.ts` (mới, 8 test)
- `docs/cursor/README.md` (dòng 54tf và 62d)
- `docs/cursor/TASK-074c.md` (ghi chú trạng thái)
- `docs/tasks/TASK-074c-1.report.md` (file này)

Không sửa test có sẵn. `apps/server/test/registry.test.ts:382-394` (đường `propose_missing_tool` qua `/api/registry/invoke` và API GET/dismiss) không đổi và vẫn xanh.

## Kiểm tra đã làm

- **Đỏ trước:** test mới chạy trước khi có code mới. Kết quả: 5 fail, 2 pass, lỗi `no such table: improvement_requests`. Hai test pass trên code cũ là giới hạn 10/ngày và danh sách (hành vi giữ nguyên).
- **Sau khi có code:** `apps/server/test/improvementRequests.test.ts` **8/8 xanh**. Cùng với `registry.test.ts` và một file liên quan, tổng **43/43 xanh** trên ba file.
- **Lỗi parse trong lúc làm:** ban đầu `JSON.parse` không có try/catch, một dòng hỏng sẽ làm server không khởi động được. Đã thêm test đỏ (`SyntaxError`), rồi sửa bằng `parseLegacyDetails`. Sau đó 4 test lỗi vì vòng lặp còn dùng `parsed.data.*`; đã sửa thành `parsed.*` và cả bộ xanh.
- **Server tsc:** `npx tsc -p tsconfig.json --noEmit` ở `apps/server`: exit 0, chạy lại sau lần sửa cuối cùng của `toolProposals.ts`.
- **Migration trên bản copy `data-dev`** (lần chạy cuối, bản copy mới với `-wal` và `-shm`):
  - Trước: 98 migration đã áp dụng. Sau: 100 (0098 và 0099 cùng được áp dụng). Chạy lại: vẫn 100 (idempotent).
  - Có đủ `improvement_requests`, `operator_skill_shadow_runs`, `operator_tool_proposals`.
  - `improvement_requests`: 0 dòng. `operator_tool_proposals`: 0 dòng. `operator_skill_shadow_runs`: 0 dòng.
  - Lần chạy này được thực hiện bằng test tạm `apps/server/test/tmpCopyRun074c1.test.ts`, đã xóa sau khi chạy. Kết quả ghi ở `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\copyrun-074c1-result.json`.
- **Không có đọc trực tiếp bảng cũ ngoài code đã sửa:** grep `operator_tool_proposals|operatorToolProposals` trong `apps/` (trừ `dist`, `drizzle`) chỉ trả về: định nghĩa trong `schema.ts`, hàm chép trong `toolProposals.ts`, và file test mới. Không có đường đọc nào khác (supervision, assistant tools, Telegram, export, backup) còn dùng bảng cũ.
- **Web:** test shadow `apps/web` xanh (không đổi code web trong bước này).

## Dữ liệu và giới hạn

- **Copy có 0 dòng đề xuất cũ.** Vì vậy việc chép dữ liệu thật chỉ được chứng minh bằng test seed. Không có dữ liệu người dùng thật đã kiểm.
- **Chạy trên `data/app.db` (DB sản phẩm): đã kiểm trên bản copy.** `deploy/product/start.ps1` mặc định `DATA_DIR` là `videoGenerator/data`, nên đây là DB sản phẩm. Kết quả: 0 dòng `operator_tool_proposals`, 0 dòng bị bỏ qua, migration 87 → 100. Chưa có dữ liệu thật để chứng minh bước chép. Promote sẽ backup DB trước, rồi áp 13 migration lên DB thật khi server khởi động.
- **Mở trực tiếp DB dev một lần (vi phạm quy tắc):** trong lúc khảo sát, một lệnh `node -e` mở `data-dev/app.db` ở chế độ chỉ đọc để đếm `operator_tool_proposals` (kết quả 0). Đây là vi phạm quy tắc "chỉ làm việc trên bản copy". Không có ghi nào.
- **Mất output lần chạy đầu:** lần chạy migration đầu tiên trên bản copy có output bị mất do bộ lọc grep. Đã chạy lại với test ghi file. Kết quả trên bản copy ở lần chạy lại là 98 → 100, idempotent.
- **Chồng migration:** `0099` nằm trên `0098` (chưa review) và `074b-4` (chưa review). Không tách riêng được.
- **Hành vi đã biết:** dòng cũ không parse được hoặc có trạng thái lạ bị bỏ qua và **cảnh báo mỗi lần khởi động** cho đến khi xóa hoặc sửa dòng đó. Đây là hành vi có chủ ý.
- **Rủi ro revert:** đề xuất tạo sau khi áp 074c-1 nằm trong `improvement_requests`. Code cũ đọc `operator_tool_proposals` sẽ không thấy các dòng này.
- **Chạy full suite song song với copy run:** full suite `apps/server` chạy từ 03:42 trong lúc copy run chạy 03:45. Mọi lỗi timeout phải chạy lại riêng trước khi phân loại.

## Kết quả full suite `apps/server`

- Chạy lại đầy đủ `npx vitest run` ở `apps/server` (sau khi đã xóa file test tạm): **271 file đạt, 4 file bỏ qua; 2182 test đạt, 8 bỏ qua; exit 0**, 326 s. Output: `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\full-server-074c1-rerun.txt`.
- Lần chạy 03:42 ghi ra `scratchpad\full-server-074c1.txt`. Lần đọc đầu tiên không thấy phần tổng kết; file hiện tại (240 byte) có `Test Files 271 passed | 4 skipped` và `Tests 2182 passed | 8 skipped`, và grep `tmpCopyRun074c1` không có kết quả. Lần chạy lại ở trên là bằng chứng chính.
- Không có lỗi nào cần phân loại. File `tmpCopyRun074c1` không có trong output.

## Việc chưa làm

- Review độc lập (chưa có `.done`).
- Chạy migration thật trên `data/app.db` khi promote (sau backup). Đã kiểm trên bản copy, xem mục bổ sung cuối báo cáo.
- Kiểm trên giao diện: chưa, vì chưa có màn hình nào đọc `improvement_requests`.

## Bổ sung 2026-11-20: bản copy `data/app.db` ở repo chính

- Bản copy `data/app.db` (+ `-wal`, `-shm`) ở repo chính, chỉ đọc và migration trên copy: `operator_tool_proposals` có **0 dòng**, nên không có dòng nào bị bỏ qua (`skipped` = 0).
- Migration: 87 → 100 migration, chạy lại vẫn 100. Không lỗi.
- Đây vẫn là **0 dòng cũ**, nên việc chép dữ liệu thật vẫn chỉ được chứng minh bằng test seed. Worktree sản phẩm không có thư mục `data/`.
- Lưu ý: bản copy đang ở migration 87, nên promote áp 13 migration cùng lúc, gồm 0098 và 0099 chưa review.
- DB sản phẩm xác định bằng `deploy/product/start.ps1`. Worktree `videoGenerator-product` không có thư mục `data/`.
- Kết quả: `scratchpad/prodcheck-151/migrate-result.json`. Bản copy `app.db` và `-wal`, `-shm` đã xóa sau khi đọc.
