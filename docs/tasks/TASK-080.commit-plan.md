# TASK-080 — kế hoạch commit (chỉ kế hoạch; chưa stage, chưa commit, chưa push)

Ngày: 2026-11-21. Base: HEAD `f367f14` (guide ghi `adba5d5`, đã cũ). Nguồn: `git status --short`, đo lại ngày 2026-11-21: 755 dòng (263 M, 492 ??). Số 753/490 cũ chụp trước khi viết `docs/cursor/TASK-153.md`; chênh lệch 2 dòng `??` là file mới (gồm `docs/cursor/TASK-153.md` và file kế hoạch này). Danh sách đầy đủ: `scratchpad/080-changed-paths.txt` (chưa đối chiếu lại với số đo mới). Người commit và push là user. Claude không chạy `git add`, `git commit` hay `git push`.

## Cách nhóm và giới hạn

- Nhóm theo khu vực (package, app, docs), không theo từng TASK. Đây là sai lệch so với bước 2 của guide. Lý do: 110 file server đã sửa mang thay đổi của nhiều task xen kẽ ở mức hunk, nên không viết được danh sách đường dẫn riêng cho từng task. Giới hạn đã biết: một commit trộn nhiều TASK. Danh sách task trong message lấy từ tên report có trong thay đổi: TASK-074b, 074c, 099, 128a, 128b, 129a, 129b, 129c, 134–152 (xem `docs/tasks`). Các task đã commit trước đó (113, 122, 123, 130–133, 074a) không nằm trong danh sách này.
- Migration đi cùng schema trong cùng commit (C2), theo thứ tự số `0080`–`0103`. Không tách để tránh commit có schema mà thiếu migration.
- Thứ tự commit theo phụ thuộc: shared trước, server sau, client (mcp, web) sau.

## Commit đề xuất (theo thứ tự)

Số lượng trong ngoặc là số đường dẫn trong `git status`.

### C1 — shared (42)
```powershell
git add packages/shared
```
Message: `feat: shared types and tests for TASK-074b–152 (see docs/tasks)`

### C2 — server schema, migrations, source (234)
```powershell
git add apps/server/src apps/server/drizzle
```
Gồm 110 file M và 75 file ?? trong `apps/server/src`, cùng migration `0080`–`0103` và `drizzle/meta/_journal.json`. Đây là commit lớn nhất. Message: `feat: server for TASK-074b–152 (migrations 0080–0103)`

### C3 — server tests (184, trừ một file giữ lại)
```powershell
git add apps/server/test ':(exclude)apps/server/test/storageProvider.test.ts'
```
Message: `test: server tests for TASK-074b–152`

### C4 — server config, asset, env và .gitignore (6)
```powershell
git add apps/server/package.json apps/server/vitest.config.ts apps/server/assets/compose/diagram apps/server/assets/compose/timeline .env.dev .gitignore
```
Trước lệnh này, nối các dòng sau vào cuối `.gitignore` (quyết định advisor 2026-11-21; Claude chưa sửa file này):
```
*.sqlite
*.sqlite3
/hermes-session.json
/tmp/
apps/server/.vitest/
apps/server/.task132-*
```
Khi user áp dụng các dòng trên, số 755 ở đầu file sẽ giảm vì các đường dẫn khớp không còn xuất hiện trong `git status`. Đã kiểm: không có đường dẫn `tmp/` nào ở bất kỳ cấp nào trong C1–C10 bị bỏ sót.
`.env.dev` được đưa vào đây vì dòng `AUTH_TRUSTED_ORIGINS` là danh sách origin thuần (kiểm tra: đếm 1 khớp mẫu `https?://host(:port),…`). Chỉ có tên biến `DATA_DIR` và `AUTH_TRUSTED_ORIGINS` được in ra. Giá trị không in.
Message: `chore: server package, vitest config, compose assets and env origins`

### C5 — mcp (10)
```powershell
git add apps/mcp
```
Message: `feat: mcp tools and sync for TASK-074b–152`

### C6 — web (73)
```powershell
git add apps/web
```
Message: `feat: web UI for TASK-074b–152`

### C7 — skill và agent (19)
```powershell
git add .agents
```
Message: `feat: video agent skills`. Test `agentSkillPack.test.ts` đọc các skill này, nên commit này đi sau C2.

### C8 — deploy (7)
```powershell
git add deploy
```
Message: `feat: worker deploy files (Docker, compose, install)`

### C9 — docs: guide, tài liệu và user guide (55)
```powershell
git add docs/cursor docs/THIRD_PARTY.md docs/knowledge docs/user-guide docs/compose docs/research docs/reviews docs/RUNBOOK-two-machines.md PROPOSALS_AND_BUGS.md
```
Gồm 35 file `docs/cursor` và 19 file docs khác (không tính `docs/ARCHITECTURE.md`), cùng `PROPOSALS_AND_BUGS.md`. Số 35 gồm `docs/cursor/TASK-153.md` (guide pause, chỉ tài liệu, viết 2026-11-21), nên C9 từ 54 lên 55. `docs/ARCHITECTURE.md` không nằm trong C9. Bản v1.0 (bước 4, đã viết 2026-11-21) được commit riêng ở C11. Message: `docs: guides, knowledge and user guide for TASK-074b–152`

### C10 — report, marker và plan của docs/tasks (118)
```powershell
git add docs/tasks
```
Gồm 117 đường dẫn có sẵn, trong đó 24 là `.done`, cùng `TASK-080.commit-plan.md` (file mới này). Marker `.done` đã được git theo dõi (ví dụ `TASK-129b.done` có trạng thái `M`), nên đây là commit thường. Advisor quyết định 2026-11-21: 24 marker `.done` hiện có đi vào commit như đang là. Message: `docs: reports and task markers for TASK-074b–152`

### C11 — ARCHITECTURE.md v1.0 (1, sau bước 4)
```powershell
git add docs/ARCHITECTURE.md
```
Chỉ thêm sau khi bản v1.0 được viết xong (bước 4). Message: `docs: ARCHITECTURE.md v1.0`

### C12 — CLAUDE.md (1)
```powershell
git add CLAUDE.md
```
Một dòng. Đã quyết định: có trong commit (advisor 2026-11-21). Message: `docs: project CLAUDE.md`

## Giữ lại, không commit (đã quyết định, advisor 2026-11-21)

| Đường dẫn | Lý do | Việc cần làm |
|---|---|---|
| `apps/server/test/storageProvider.test.ts` (??) | Dòng 15 có chuỗi dạng AWS access key ID (`AKIA` + 16 ký tự) trong literal `accessKeyId`. Không khớp mẫu `EXAMPLE`, không có `TEST`/`FAKE`, không lặp ký tự. Kiểm tra bổ sung (chỉ đếm): 2 dòng có chuỗi 40 ký tự dạng bí mật; chuỗi `AKIA` không xuất hiện trong `.env` (đếm 0). Vì số dòng 40 ký tự khác 0, không hạ xuống "fixture" được. | Advisor quyết định 2026-11-21: file này giữ ngoài commit. Đã thử thay literal bằng script: test đỏ (regex cũng thay một phần giá trị kỳ vọng của test known-answer). Đã khôi phục từ bản sao, `cmp` giống hệt. Việc thay literal không nằm trong commit này. |
| `hermes-session.json` (??) | Dump lỗi của Hermes, có khóa API đã che. Memory ghi rõ không commit. | Loại khỏi commit. Thêm vào `.gitignore` theo quyết định advisor 2026-11-21 (xem ghi chú bước 3). |
| `tmp/` (??, khoảng 7,5 MB log) | Log review cũ, không phải mã nguồn. | Loại khỏi commit. |
| `apps/server/.vitest/` (??) | Cache của vitest. | Loại khỏi commit. |
| `apps/server/.task132-drizzle.config.ts`, `apps/server/.task132-migrations/` (??) | Thư mục tạm của TASK-132 (memory ghi là cố ý giữ untracked). | Loại khỏi commit. |

> **Đính chính 2026-11-21 (advisor):** dòng `apps/server/test/storageProvider.test.ts` trong bảng trên có chuỗi cuối dòng 15 kết thúc bằng `EXAMPLE` và dòng 16 kết thúc bằng `EXAMPLEKEY`, không phải mẫu bí mật thật; không chuỗi nào có trong `.env*`. File được commit nguyên bản, riêng một commit cục bộ `838b617`, không sửa literal. Máy quét bí mật vẫn có thể báo khi push.

## Ghi chú cho bước 3 (kiểm tra bí mật)

- Đã quét 1180 file trong các đường dẫn thay đổi, gồm cả file chưa theo dõi (`git ls-files --others --exclude-standard`), theo mẫu khóa phổ biến: AWS `AKIA`, khóa private PEM, `ghp_`, `AIza`, `xox*`, `Bearer` (không phân biệt hoa thường: 0 file). Kết quả: 1 file khớp (`storageProvider.test.ts`, dòng 15), đã nêu ở trên. Không in giá trị nào.
- Tên file nhạy cảm (`.sqlite`, `.sqlite3`, `.db`, `.pem`, `.key`, `cookie`, `token`, `.claude/`) trong các đường dẫn thay đổi: 0.
- `.sqlite` và `.sqlite3` ngoài thư mục `data/`, `data-dev/`, `node_modules`: 0 file, và 0 file chưa theo dõi khớp.
- Quy tắc ignore thực tế (đọc `.gitignore` và `git check-ignore`):
  - `.env` (dòng 5), `data/` (dòng 4), `data-dev/` (dòng 23) được chặn.
  - `*.db`, `*.db-shm`, `*.db-wal` (dòng 7–9) được chặn. **`*.sqlite` và `*.sqlite3` KHÔNG có trong `.gitignore`.** Quyết định advisor 2026-11-21: thêm vào `.gitignore` các mục `*.sqlite`, `*.sqlite3`, `hermes-session.json`, `tmp/`, `apps/server/.vitest/`, `apps/server/.task132-*` (đã kiểm bằng `git ls-files`: không mục nào đang được theo dõi). Claude không sửa `.gitignore` theo guide TASK-080. Việc áp dụng ghi vào bước C4 để user chạy; chưa được áp dụng trong phiên này.
  - `.claude/` **không** được chặn toàn bộ. Chỉ `.claude/settings.local.json` bị chặn, qua global ignore của máy (`C:\Users\defu\.config\git\ignore`). `.claude/launch.json` được git theo dõi. Guide ghi "`.claude/` ignored" là không đúng.
- Claude không sửa `.gitignore`; các dòng cần thêm nằm ở C4.

## Việc tiếp theo

1. Quyết định đã chốt (advisor 2026-11-21): `storageProvider.test.ts` giữ ngoài commit; các mục `.gitignore` nêu ở ghi chú bước 3 áp dụng trong bước C4. Việc còn lại của user: chạy C1–C12 (commit và push).
2. Bước 4 (ARCHITECTURE.md v1.0) đã viết xong ngày 2026-11-21, không phụ thuộc việc duyệt commit. Đường dẫn và liên kết trong file đã được kiểm; liên kết tới `docs/ARCHITECTURE-TARGET.md` ghi rõ là việc chưa làm.
3. `TASK-080.done` chỉ được tạo sau khi user xác nhận đã commit và push.
4. Migration `0098` không áp dụng trong phiên này. 074b-4 điều kiện 2 và 4 hoãn khi cờ `autoActivateReadOnlySkills` còn tắt (advisor 2026-11-21).

## Quyết định khác (advisor 2026-11-21)

- `.claude/launch.json` giữ nguyên trạng thái đang được git theo dõi, không đổi.
- `research-provider.md` (file workspace cũ) giữ nguyên; không có dòng DB nào tham chiếu tên này.
- NULL `run_id` trong bảng skill shadow không được migrate; để nguyên.

## Cập nhật 2026-11-21: user yêu cầu Claude commit
User yêu cầu Claude commit C1–C12 theo thứ tự trong file này (advisor 2026-11-21). Chỉ commit, không push. `storageProvider.test.ts` vẫn giữ ngoài commit. `TASK-080.done` chưa tạo (gắn với push).
