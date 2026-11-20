# TASK-151 — báo cáo: đổi tên skill nghiên cứu `research-provider`

**Trạng thái:** đã code và chạy test. **Chưa được review.** Không có `.done`. Không commit, không push.
**Guide:** `docs/cursor/TASK-151.md`.

## File đã đổi

- `apps/server/test/operatorSkillNames.test.ts` (mới): tên trong `OPERATOR_SKILLS` phải duy nhất; mục tên `research-provider` không được có `research`.
- `apps/server/src/research/skills.ts:13`: `name` đổi thành `research-provider-terms`. `question`, `outputKinds`, `sources` giữ nguyên. `topic`/`triggers` suy ra từ `name`.
- `apps/web/src/features/research/ResearchPage.tsx:22`: thêm khóa `research-provider-terms` với nhãn "Nhà cung cấp"; giữ khóa `research-provider` để dòng lịch sử cũ có nhãn. `skillLabels` chỉ dùng để tra nhãn; danh sách lựa chọn lấy từ `data.skills` của server, nên khóa cũ không trở thành lựa chọn.
- `.agents/skills/video-tu-nghien-cuu/SKILL.md:30`: liệt kê `research-provider-terms`.
- `apps/server/test/researchRun.test.ts`: ca mới, `run_research` với `research-provider` bị từ chối `RESEARCH_SKILL_INVALID` (400) và không tạo dòng `research_runs`.
- `apps/server/test/operatorAutoActivation.test.ts`: ca dương mới, mẫu theo `research-market`. Bản shadow của `research-provider-terms` với 5 lượt chạy và eval đạt được kích hoạt.

Không đổi: mục không nghiên cứu `apps/server/src/operator/skills.ts:120-121`; `agentSkillPack.test.ts:71-75`; `ResearchPage.test.tsx:35` (fixture cũ, bằng chứng cho khóa legacy); `writeGuard.ts`; không có migration.

Chuỗi tham chiếu tên cũ đã kiểm: grep literal `research-provider` trong `apps/server/src apps/server/test apps/web/src apps/mcp/src packages/shared/src .agents/skills`, và grep tên dựng động (`research-${`, `"research-" +`): không có chỗ dựng động nào.

**Ghi chú về guide, bước 4:** `docs/cursor/TASK-074.md:96` vẫn nhắc `research-provider`. Đây là tài liệu lịch sử, chưa sửa theo guide.

## Kết quả kiểm

- Kiểm đỏ trước khi giữ thay đổi: hoàn nguyên `research-provider-terms` về `research-provider` trong `src/research/skills.ts`, chạy ba ca mới. Cả ba **đỏ** (`every skill name is unique`, `refuses the retired research-provider name`, `activates the renamed research-provider-terms skill`). Sau đó áp lại đổi tên.
- `apps/server` bộ rộng: `npx vitest run test/operator*.test.ts test/research*.test.ts test/registry.test.ts test/agentSkillPack.test.ts`: **19 file, 201 test, tất cả xanh.**
- `apps/server` test đọc file skill `.agents`: `test/repoSkills.test.ts`, `test/skillParse.test.ts`: **9 test xanh.**
- `apps/web`: `npx vitest run src/features/research src/features/operator/RepoSkills.test.tsx`: **xanh.**
- `apps/server`: `npx tsc -p tsconfig.json --noEmit`: **exit 0.**
- `apps/web`: `npx tsc -p tsconfig.json --noEmit`: **không có lỗi.**

## Dữ liệu đã đọc (chỉ đọc, trên bản copy)

Copy `data-dev/app.db` (+ `-wal`, `-shm`) và `data/app.db` (+ `-wal`, `-shm`) vào thư mục scratchpad rồi đọc bản copy. File gốc không được mở ở chế độ ghi. Các bản copy đã xóa sau khi đọc.

- `data-dev/app.db` (dev, theo `.env.dev` `DATA_DIR=./data-dev`): `operator_skill_versions`, `skill_claims`, `skill_reports`, `research_runs` đều **0 dòng**. Không có dòng nào mang tên `research-provider`.
- `data/app.db` (thư mục `data/` của repo chính `videoGenerator`; worktree sản phẩm `videoGenerator-product` không có thư mục này, xem mục bổ sung bên dưới): cùng kết quả, **0 dòng**.
- `operator_skill_shadow_runs` **không tồn tại** trong cả hai bản copy (migration 0098 chưa áp dụng ở đây). Không đọc được bảng này.
- Đây là kiểm tra trên dữ liệu có sẵn, không phải dữ liệu người dùng thật có lịch sử nghiên cứu.
- Cập nhật 2026-11-20: đã kiểm trên DB sản phẩm (bản copy), xem mục bổ sung cuối báo cáo.

Không khởi động dev server để kiểm trên trình duyệt: làm vậy sẽ áp migration 0098 (chưa review) lên `data-dev`. Vì lý do đó, phần kiểm giao diện trang nghiên cứu chưa thực hiện.

## Rủi ro còn lại (không tự xử lý)

1. **File workspace cũ còn sót.** `apps/server/src/operator/workspace.ts:106` chỉ ghi file, không xóa. Workspace đã tồn tại vẫn giữ `skills/tu-cai-tien/research-provider.md` cũ. Không xóa tự động. Cần người dùng quyết định khi cần dọn.
2. **Bản nền của tên cũ.** `behaviourGate.ts:98` và `skillVersions.ts:28` không còn gặp mục nghiên cứu theo tên `research-provider`. Đó là chủ đích. Nếu có bản DB `active` mang tên cũ kèm frontmatter nghiên cứu, bản đó sẽ lệch. Hiện không có dữ liệu như vậy.
3. **Lịch sử `research_runs`** cũ với `skill = 'research-provider'` vẫn còn nếu có. Nhãn trang nghiên cứu vẫn hiển thị nhờ khóa legacy.

## Chưa xác minh

- Chưa kiểm trên trình duyệt (trang nghiên cứu không được chạy thử giao diện).
- Chưa kiểm trên dữ liệu thật có lịch sử nghiên cứu. DB sản phẩm (bản copy) không có dòng nào mang tên cũ.

## Bổ sung 2026-11-20: bước 5 trên `data/app.db` (repo chính), chỉ đọc trên bản copy

- Worktree sản phẩm `videoGenerator-product` không có thư mục `data/`. `deploy/product/start.ps1` mặc định `DATA_DIR` là `videoGenerator/data`, nên DB sản phẩm là `videoGenerator/data/app.db`. Đã kiểm bản copy của file này (+ `-wal`, `-shm`), file gốc không mở.
- Đếm tên `research-provider` trong `operator_skill_versions` (cột `name`), `skill_claims` (`skill`), `skill_reports` (`skill`), `research_runs` (`skill`): **0 dòng** mỗi bảng. Kết quả trong `scratchpad\prodcheck-151\check-out.json`.
- `operator_skill_shadow_runs` không tồn tại trước migration (copy ở migration 87).
- Migration chạy trên bản copy: 87 → 100 migration, chạy lại vẫn 100 (idempotent). Chi tiết: `scratchpad\prodcheck-151\migrate-result.json`.
- Kết luận: DB sản phẩm (bản copy) không có dòng nào mang tên `research-provider`, nên không có dữ liệu tên cũ cần xử lý. Bước 5 coi như đã làm. Promote vẫn áp migration lên DB thật sau backup.
