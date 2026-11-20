# TASK-074b-3a — báo cáo: shadow ghi lại lượt định tuyến skill (không chạy)

**Trạng thái:** code, test, migration và web đã xong. **Chưa có `.done`**: chờ Codex review.

## 1. Điểm commit (đọc lại ngày 2026-11-19 sau khi sửa)

- `apps/server/src/operator/service.ts:1105`: `const suggestion = this.suggestion(job.prompt, job.runId);`. Gợi ý được ghép vào `message` ở `:1107–1110`, rồi `runtime.run({` ở `:1112`. Đây là chỗ một run cam kết dùng skill.
- `runtime.run` → `apps/server/src/operator/cursorRuntime.ts:19` → `runCursorProcess` tại `apps/server/src/operator/runtime.ts:33`. `runtime.ts` không chọn skill; điểm chọn nằm ở `service.ts`.
- Điểm định tuyến có ghi shadow: `findSkills` (`service.ts:612`; `recordShadow` ở `:616`, sau `logRouting`) và `suggestion` (`recordShadow` ở `:1203`, sau `logRouting` ở `:1202`). `recordShadow` định nghĩa ở `:1339`.

## 2. Migration

- Tên: `apps/server/drizzle/0098_operator_skill_shadow_runs.sql`, idx 98 trong `meta/_journal.json` (tag `0098_operator_skill_shadow_runs`), snapshot `meta/0098_snapshot.json`. Sinh bằng `drizzle-kit generate --name operator_skill_shadow_runs`. Không sửa tay.
- Bảng `operator_skill_shadow_runs`: `id`, `skill_name`, `shadow_version`, `active_version` (nullable), `run_id` (nullable), `query`, `rank` (nullable), `planned` (JSON text), `created_at`. Hai index: `(skill_name, shadow_version)` và `(run_id)`.
- So với snapshot trước thay đổi (`drizzle-snap-074b3a`): `diff -rq` chỉ có 3 khác biệt: file SQL mới, `meta/0098_snapshot.json`, và một entry idx 98 trong journal.
- Áp dụng lên **bản sao** của dev DB (copy `app.db` + `-wal` + `-shm` trong scratchpad; DB gốc và `data/` không bị đụng): `__drizzle_migrations` từ 98 lên 99, bảng có đủ 9 cột. Không có migration nào khác bị áp dụng.
- **Chưa áp dụng lên DB dev thật.** Việc đó để sau khi Codex review.

## 3. Marker shadow: sai khác so với spec

Spec `docs/cursor/TASK-074b-3a.md`, mục 3, nguyên văn: "use the existing `operator_skill_versions` status field **only if it already has a value for this**; otherwise store the shadow marker in a column that the migration adds (report which)."

- Trạng thái hiện có là `draft`, `active`, `archived`, `needs_merge`. **Không có giá trị nào dành cho shadow**, nên đây là sai khác so với chữ của spec.
- Thứ đã làm: thêm giá trị `'shadow'` vào cột `operator_skill_versions.status`, **không thêm cột**. Lý do: cột là `text("status").notNull()` trong `apps/server/src/db/schema.ts` (không có enum ở DB), nên giá trị mới không cần migration. Thêm cột sẽ cần migration thứ hai (0099).
- Reviewer quyết định: giữ `'shadow'`, hoặc yêu cầu cột riêng (khi đó cần 0099 và sửa `markShadowVersion`, `shadowVersionFor`, `clearShadowVersion`, `activateSkillVersion`).
- Quy tắc: một skill có tối đa một `shadow`. `markShadowVersion` chuyển shadow cũ thành `archived` và đặt bản draft thành `shadow`; chỉ bản `draft` được đặt (`SKILL_NOT_DRAFT` cho các trạng thái khác). `clearShadowVersion` chuyển `shadow` về `draft`.
- `activateSkillVersion` từ chối `shadow` với mã `SKILL_IS_SHADOW`. Danh sách active (`listSkillVersions(db, true)`) chỉ lấy `status='active'`.
- **Không có route nào gọi `markShadowVersion`** (đã kiểm tra bằng grep). Shadow chỉ đặt được bằng code. Việc này thuộc 074b-3b (xem `docs/cursor/TASK-074b-3b.md`).

## 4. Gate, ghi, và các quy tắc của spec

- Cài đặt `operator.shadowEnabled` (`packages/shared/src/schemas/operator.ts`): mặc định `false`, có trong `OperatorSettingsSchema` và `OperatorSettingsUpdateSchema` (optional). `packages/shared/dist` đã được build lại.
- `apps/server/src/operator/shadow.ts` `recordShadowRuns`: kiểm tra gate **đầu hàm**. Gate tắt thì không ghi row.
- Một row mỗi skill mỗi lần gọi. Với skill xuất hiện ở nhiều phần của cùng truy vấn, `rank` là vị trí 1-based trong danh sách của phần đầu tiên chứa skill đó.
- `planned` = `tools` trong frontmatter của bản shadow, qua `parseSkillMarkdown`. **Nếu không khai báo tools, hoặc markdown không parse được, `planned` = `[]`.** Spec yêu cầu thêm "say so in the row"; phần này **chưa làm**: không có marker riêng, `[]` là dấu hiệu duy nhất.
- Kết quả trả về cho caller không đổi: `recordShadowRuns` không sửa `routed`.
- Lỗi khi ghi được log bằng `this.logger.error` và không ném ra ngoài, để không đổi kết quả định tuyến. Hệ quả: nếu bảng bị thiếu, lỗi chỉ xuất hiện trong log.
- Shadow chỉ được ghi khi tên skill xuất hiện trong kết quả định tuyến. Định tuyến chỉ lấy skill active, nên skill chưa có bản active sẽ không có row.
- Không thay đổi điểm số, thứ hạng, hay hành vi của bản active.

## 5. Kiểm thử

### Test shadow: `apps/server/test/operatorShadow.test.ts` — 9/9 pass

| Test | Nội dung |
|---|---|
| gate off | `findSkills` và `suggestion` có shadow, gate tắt → 0 row |
| gate on (findSkills) | 1 row; `planned` = tools của shadow; `rank` = 1; `active_version` = 1; kết quả trả về giống gate tắt |
| gate on (suggestion) | 1 row với `run_id` đúng; chuỗi gợi ý giống gate tắt |
| non-execution | `runTool` và `runCursorProcess` mock để ném lỗi; `findSkills` và `suggestion` đều return, và cả hai mock **không được gọi lần nào** (assert số lần gọi) |
| baseline | trước và sau khi có shadow, routing giống nhau; hit `shadow-probe` vẫn `version: 1` |
| không thực thi (tĩnh) | `shadow.ts` chỉ import `better-sqlite3`, `node:crypto`, `./routing.js`, `./settings.js`, `./skillVersions.js`, `./skills.js` |
| active không bao giờ là shadow | `listSkillVersions(db, true)` chỉ còn v1; `activateSkillVersion` shadow → `SKILL_IS_SHADOW` |
| quy tắc trạng thái (mới thêm) | markShadow chuyển v2 thành `archived` và v3 thành `shadow`; markShadow với v1 (active) → `SKILL_NOT_DRAFT`; clearShadow trả 1 và v3 về `draft` |
| skill không có shadow | gate bật, không có row |

Ghi chú: `not.toThrow` không chứng minh gì một mình, vì `recordShadow` nuốt lỗi. Bằng chứng là assert số lần gọi mock.

**Mutation check** (khôi phục sau mỗi lần; sau khi khôi phục không còn dấu `MUTANT` trong `shadow.ts`, 8 test gốc xanh):
- **A. Bỏ gate** (dòng `if (!getOperatorSettings…) return 0;` thành comment): 3 test đỏ: `gate off`, `gate on` (findSkills), `gate on` (suggestion). Test không có shadow vẫn xanh.
- **B. Thêm lời gọi `runCursorProcess`** vào vòng ghi: test `non-execution` đỏ (`called 2 times`).
- **C. Thêm lời gọi `runTool`** vào vòng ghi: test `non-execution` đỏ (mock được gọi).

### Bộ test đầy đủ (chạy sau mọi sửa đổi)

Lệnh: `npx vitest run` trong từng package.

| Package | Test files | Tests | Kết quả |
|---|---|---|---|
| `apps/server` | 269 (265 pass, 4 skip) | 2093 (2085 pass, 8 skip) | pass, exit 0 (chạy cuối, sau mọi sửa; log `scratchpad/server-test-final.log`, 304 s) |
| `apps/web` | 90 | 246 | pass |
| `apps/mcp` | 7 | 65 | pass |
| `packages/shared` | 98 | 788 | pass |

### Typecheck

- `apps/server`: `npx tsc --noEmit -p .` exit 0 (chạy lại sau sửa cuối).
- `apps/web`: `tsc -p tsconfig.json --noEmit` exit 0.
- `apps/mcp`: `tsc --noEmit -p .` exit 0.
- `packages/shared`: `tsc -p tsconfig.json` exit 0 (build, tạo `dist`).

### Git

- `git status --porcelain`: 625 dòng trong snapshot `scratchpad/status-final.txt` (lấy lúc chạy test, 2026-11-19). Sau đó các guide mới được thêm (`docs/cursor/TASK-074b-2.md`, `TASK-074b-3b.md`, `TASK-074b-4.md`, đều không phải code). `git status --short | wc -l` lúc viết báo cáo cuối là 628. Số này là ảnh chụp, không phải cơ sở để đối chiếu. Các file đã sửa vốn đã nằm trong danh sách này. Thư mục tạm không nằm trong repo. Không có file `.done` nào cho 074b-1 hay 074b-3a.

## 6. Nơi đọc status và settings

- `'shadow'` đã thêm vào union trong `apps/server/src/operator/skillVersions.ts` và `apps/web/src/features/operator/SkillVersions.tsx`. Nhãn: "Shadow (chỉ ghi nhận, không chạy)". Nút "Duyệt và dùng" / "Khôi phục phiên bản" bị ẩn với shadow.
- `learningReport` (`apps/server/src/operator/service.ts:796`) chỉ lấy `active` và `draft`; shadow không xuất hiện. Chủ ý.
- `saveSkillDraft`: kiểm tra `latest?.status === 'draft'` cho `repeated_failure`. Một shadow làm `latest` sẽ không gộp vào draft; đó là hành vi đúng.
- Thông báo lỗi khi activate shadow đã sửa: bỏ câu "Tắt shadow trước" vì app chưa có cách tắt shadow qua giao diện.
- `shadowEnabled` được kiểm tra qua `saveOperatorSettings` trong test. Route `PUT /api/operator/settings` (`apps/server/src/api/operator.ts:148`) đi qua `OperatorSettingsUpdateSchema`, nên **đã nhận** `shadowEnabled` qua API. Không có UI để bật/tắt, và route này **chưa được test HTTP** với trường mới. Vì vậy "không có cách bật" là sai; đúng là "không có UI, bật được qua API".
- Giao diện web cho shadow **chưa được kiểm tra trên trình duyệt**: không có cách nào trong app tạo shadow, nên nhãn không được hiển thị với dữ liệu thật.

## 7. Điểm mở (cho 3b và reviewer)

1. **Chưa có route đặt/bỏ shadow**, nên shadow chỉ tạo được bằng code. 3b sẽ thêm route và cổng 074b-2 (`docs/cursor/TASK-074b-3b.md`).
2. **Đếm kép (sai khác so với spec item 6, `docs/cursor/TASK-074b-3a.md`, cùng loại với mục 8):** spec item 6 nói các lời gọi `findSkills` và `suggestion` trong cùng một lượt đếm **một lần**, và row không có `run_id` đếm mỗi row một lần. 3a không đạt vế đầu. `findSkills` ghi row với `run_id` NULL (`service.ts:615–616`), còn `suggestion` ghi row với `run_id` (`service.ts:1202–1203`). Với hai row như vậy, công thức `COUNT(DISTINCT COALESCE(run_id, id))` đếm lượt này **hai lần**. 3a không sửa công thức vì công thức thuộc 3b. 3b chọn một trong ba cách (`docs/cursor/TASK-074b-3b.md`, Open questions).
3. **Nút "Khôi phục phiên bản" trên shadow cũ:** bản shadow bị thay thế thành `archived` và hiện nút Khôi phục, dù chưa từng active. 3b cần sửa.
4. **Shadow chỉ được ghi khi skill có bản active đang được định tuyến.** Skill mới chưa có bản active sẽ không có row.
5. **Lỗi ghi shadow chỉ nằm trong log.** Nếu cần cảnh báo, 3b phải theo dõi số row.
6. **Chưa có dữ liệu thật:** chỉ thử trên bản sao DB và trong test. Chưa đo số lượt routing có shadow trên dữ liệu dev.
7. **Không có marker riêng cho "không khai báo tools"** (xem §4).
8. **Sai khác về marker** (xem §3): cần reviewer quyết định. Đây là sai khác thứ nhất; sai khác thứ hai là đếm kép (mục 2).

## 8. File thay đổi

- `packages/shared/src/schemas/operator.ts` (`shadowEnabled`), `packages/shared/dist` (build lại)
- `apps/server/src/db/schema.ts` (bảng `operatorSkillShadowRuns`)
- `apps/server/drizzle/0098_operator_skill_shadow_runs.sql`, `meta/0098_snapshot.json`, `meta/_journal.json`
- `apps/server/src/operator/skillVersions.ts` (status `shadow`, `markShadowVersion`, `shadowVersionFor`, `clearShadowVersion`, từ chối activate)
- `apps/server/src/operator/shadow.ts` (mới)
- `apps/server/src/operator/service.ts` (`recordShadow` ở `findSkills` và `suggestion`)
- `apps/server/test/operatorShadow.test.ts` (mới)
- `apps/web/src/features/operator/SkillVersions.tsx`

## 9. File tạm cần người dùng xử lý

- `C:/Users/defu/AppData/Local/Temp/shadow.bak.ts` (1897 byte). Đây là bản sao lỗi của `shadow.ts` trước khi đột biến, tạo ra do một lệnh `cp` dự phòng ghi sai đường dẫn. **Chưa xoá**: lệnh xoá bị chặn bởi kiểm tra an toàn của hệ thống. Nó nằm ngoài repo nên không ảnh hưởng commit, nhưng cần người dùng quyết định có xoá không.

## 10. Hiệu chỉnh sau review advisor (2026-11-20, TASK-152)

Phần trên giữ nguyên; các điểm dưới đây sửa phần trên.

- **Shadow cũ thành `draft`, không còn `archived`.** §3 ghi `markShadowVersion` chuyển shadow cũ thành `archived`. Sai. 074b-3b đổi thành `draft` (`skillVersions.ts`, `markShadowVersion`). Đúng: shadow cũ về `draft`; chỉ bản `draft` được đặt làm shadow.
- **Test 3a bị 074b-3b sửa.** test "shadow state rules" trong `test/operatorShadow.test.ts` (dòng 199) đã đổi theo 3b. Kết quả 9/9 ở §5 là trước khi 3b sửa; kỳ vọng hiện tại khác.
- **Bảo đảm "không chạy gì" đã được 074b-4 thu hẹp.** §5 ghi non-execution cho `findSkills` và `suggestion`. Đúng với 3a, nhưng 074b-4 thêm `autoActivateAfterShadow` ngay sau `recordShadow` ở hai đường này. Khi cờ `autoActivateReadOnlySkills` bật (hiện tắt; `operator/service.ts:907` truyền cờ vào `checkAutoActivation` làm `autoEnabled`, và `autoActivation.ts:95` trả về rỗng khi tắt), đường đó có thể đổi `status` (shadow → draft → active) và ghi `writeUserSkill`. Vẫn không chạy công cụ hay tiến trình Cursor; nhưng có ghi DB và file. Bảo đảm đúng sau 074b-4: không thực thi, có thể kích hoạt.
- **Giới hạn kích hoạt của shadow (review 3a, phát hiện 1).** Shadow chỉ ghi khi skill xuất hiện trong kết quả định tuyến, và định tuyến chỉ lấy bản active. Đã nêu ở §4 và §7 mục 4; xác nhận lại ở đây.

Không có `.done` cho 074b-3a. Chờ Codex review.
