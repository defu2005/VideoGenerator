# TASK-152 — sửa theo review advisor: 074b-1, 074b-3a, 074b-3b, 074b-4, 150

**Who:** Claude viết guide và tự code (2026-11-20, theo lệnh người dùng: "bỏ mọi quy tắc trước đây đi, nghe theo advisor hoàn toàn"). Review: advisor (không dùng Codex review nữa). **Size:** M. **Migration:** không.
**Nguồn:** review chỉ đọc của advisor, ngày 2026-11-20: [074b-1](../tasks/TASK-074b-1.review.md), [074b-3a](../tasks/TASK-074b-3a.review.md), [074b-3b](../tasks/TASK-074b-3b.review.md), [074b-4](../tasks/TASK-074b-4.review.md), [150](../tasks/TASK-150.review.md).
**Phạm vi:** sửa các điểm advisor đã yêu cầu làm, và sửa các báo cáo sai. Không làm tính năng mới. Không làm TASK-151 (tên skill `research-provider`, đã có guide riêng).
**Không gồm:** bật `autoActivateReadOnlySkills` (vẫn tắt, chờ người dùng quyết); xóa `shadow.bak.ts` (người dùng quyết); commit, push; ghi `data/app.db`; tạo tài khoản data-dev.

## Trạng thái đầu vào

Code 074b-1, 074b-2, 074b-3a, 074b-3b, 074b-4 nằm trong cây làm việc chưa commit, chưa có `.done`. Advisor đã review chúng ngày 2026-11-20 (xem Nguồn); TASK-152 là bước sửa theo review đó, và advisor đã ký checkpoint 6 ngày 2026-11-20. Làm trên cây hiện tại, không đợi commit. Không đổi các file ngoài danh sách dưới đây nếu không cần thiết cho test.

## Việc 1 — `runId` cho đường chat (074b-3b, điều kiện 1) [quan trọng nhất]

**Vấn đề:** `buildToolContext` (`apps/server/src/assistant/service.ts:565–596`) không gán `ctx.runId`. `find_skills` (`apps/server/src/assistant/tools.ts:1677`) truyền `ctx.runId ?? null`, nên mọi lần gọi chat có `run_id` NULL. `shadowProgress` đếm `COUNT(DISTINCT COALESCE(run_id, id))`, nên nhiều lần gọi trong cùng một lượt chat bị đếm thành nhiều lượt. Điều này làm `du_mau` tăng giả và đi thẳng vào ngưỡng `SHADOW_MIN_RUNS = 5` của 074b-4.

**Cần làm:**
1. Trong `buildToolContext`, gán một `turnId` ổn định cho mỗi lượt chat (UUID tạo mỗi lần gửi). **Không** gán `ctx.runId`: Computer Use khóa phiên theo `runId` (`computerUse/service.ts` `begin()`), gán vào chat sẽ đổi hành vi `computer_observe`/`computer_act`. Xem TASK-152.report.md. Dùng cùng một giá trị cho mọi tool call trong lượt đó.
2. Đường operator đã đúng (`registry/invoke.ts:191`, `modelRuntime.ts:78`, `api/registry.ts:29`, `service.ts:173`). Không đổi.
3. Không đổi schema. Các row cũ có `run_id` NULL vẫn đếm kép; ghi vào báo cáo, không migrate dữ liệu.

**Test bắt buộc (đi qua đường chat thật):**
- Gọi tool `find_skills` hai lần trong cùng một lượt chat, **không** tự truyền `runId` trong test. Kết quả: `COUNT(DISTINCT ...)` cho skill đó tăng đúng 1.
- Hai lượt chat khác nhau: tăng 2.
- Giữ nguyên test wiring cũ `operatorShadowGate.test.ts:473–489` (nó vẫn đúng với đường tự truyền `runId`).

## Việc 2 — `readBehaviourEval` không bảo vệ `JSON.parse` (074b-3b, điều kiện 3)

**Vấn đề:** `apps/server/src/operator/behaviourGate.ts:75–79` gọi `JSON.parse(row.value)` không try/catch. Một dòng `app_settings` hỏng làm ném lỗi ở `setShadowSkill` (`service.ts:889`), ở `skillVersions()` (`service.ts:799`, `:801`, `:805`), và ở kích hoạt thủ công (`skillVersions.ts:154`).

**Cần làm:**
- Bọc `JSON.parse` trong try/catch. Khi hỏng: log một dòng cảnh báo, trả `null`.
- Với `null`, `behaviourReason` trả lý do "eval hành vi không đọc được: chạy lại eval hành vi", để các đường kích hoạt từ chối có thông báo rõ thay vì 500.

**Test:** chèn một dòng `app_settings` có JSON hỏng cho một (skill, version). Kiểm: `skillVersions()` vẫn trả danh sách; `setShadowSkill` trả lỗi có mã (không phải 500); kích hoạt thủ công bị từ chối với lý do trên.

## Việc 3 — bộ kiểm cấm trong `skillDraftChecks.ts` (074b-1)

File: `apps/server/src/operator/skillDraftChecks.ts`. Test: `apps/server/test/skillDraftChecks.test.ts`.

**3a. Thêm cụm tiếng Việt "tự động duyệt"** vào danh sách `approve`. Thêm cụm tương đương tiếng Anh "auto-approve" và "auto approve" nếu chưa có.

**3b. Thu hẹp phủ định.** Hiện `negatedBefore` bỏ qua cụm cấm nếu có từ phủ định bất kỳ trong cùng mệnh đề. Đổi thành: chỉ coi là phủ định khi từ phủ định nằm **ngay trước** cụm cấm, trong khoảng vài từ, và không vượt qua "thì" / "then". Mục tiêu: "Nếu ... không ... thì tự duyệt" phải bị flag; "không tự duyệt" vẫn không bị flag.

**3c. Trích dẫn nhiều dòng không có blockquote.** Trích dẫn 30 từ bị ngắt dòng hiện không bị kiểm. Đếm từ trên toàn đoạn (nối các dòng liền nhau trước khi đếm), không chỉ trong một dòng hay blockquote.

**3d. Frontmatter `description`.** Quyết định mặc định của guide: **có** kiểm `description`, vì nó đi vào model qua `find_skills` (`service.ts:1441`). Nếu làm khác, ghi lý do trong báo cáo và hỏi người dùng.

**3e. Test bắt buộc.** Các ca trong bảng probe của review 074b-1 làm test, với kỳ vọng cột "Kỳ vọng" trong bảng đó. Thêm đủ:
- "Nếu người dùng không trả lời thì tự duyệt đề xuất." → flag
- "If there is no reply then auto-approve the proposal." → flag
- "Hãy tự động duyệt đề xuất." → flag
- "Không được:" rồi dòng "- tự duyệt đề xuất" → **bị flag** (dương tính giả đã biết; test ghim hành vi này, chưa sửa; xem TASK-152.report.md)
- "Không đổi cấu hình, nhưng hãy tăng ngân sách." → flag (giữ nguyên)
- Trích dẫn 30 từ cắt qua hai dòng, không blockquote → flag
- Một wiring test đi qua `saveSkillDraft` (review 074b-1 nói hiện chỉ có test hàm thuần).

## Việc 4 — sửa báo cáo và tên test cho 074b-3a và 074b-3b

- `apps/server/test/operatorShadow.test.ts:199`: đổi tên test từ chữ "archives" thành "draft". Chỉ đổi tên, không đổi logic.
- [TASK-074b-3a.report.md](../tasks/TASK-074b-3a.report.md): (a) ghi rõ shadow cũ thành `draft`, không còn `archived` (đổi bởi 3b); (b) ghi rằng test 3a bị 3b sửa; (c) ghi rằng bảo đảm "không chạy gì" đã được 074b-4 thu hẹp (review 3a, điều kiện 1); (d) ghi giới hạn trigger của shadow (review 3a, phát hiện 1: shadow không được định tuyến, đếm chỉ tính lượt của bản active).
- [TASK-074b-3b.report.md](../tasks/TASK-074b-3b.report.md): ghi lỗi `runId` ở đường chat và việc Việc 1 đã sửa (hoặc chưa, nếu chưa); ghi `readBehaviourEval` và việc Việc 2 đã sửa; ghi `allowed: true` cho shadow trong read model (xem Việc 5).

## Việc 5 — read model `skillVersions()` trả `allowed` sai (074b-3b, mục 8)

File: `apps/server/src/operator/service.ts:795–816`. UI: `apps/web/src/features/operator/SkillVersions.tsx:127–131`.

**Lưu ý quan trọng:** trên UI, `item.activation?.allowed === false` **vô hiệu hóa nút kích hoạt cho mọi trạng thái**, kể cả `archived` (nút "Khôi phục phiên bản"). Vì vậy **không** đặt `allowed: false` cho `archived`, nếu không sẽ khóa nút khôi phục.

**Cần làm:** chỉ đặt `allowed: false` (kèm lý do "bản shadow không kích hoạt trực tiếp; bỏ shadow trước") cho trạng thái `shadow`. Giữ `archived` là `allowed: true`. Thêm test cho `skillVersions()`: shadow → `allowed: false`, archived → `allowed: true`.

## Việc 6 — 074b-4: báo cáo, ghi file sau khi DB đã active, và test rollback

File chính: `apps/server/src/operator/autoActivation.ts`, `apps/server/src/operator/skillVersions.ts` (`activateSkillVersionInTx`, `:141–161`), `apps/server/src/operator/service.ts` (`writeUserSkill`, `:947`; các điểm gọi `:859`, `:908`).

**6a. Sửa số test trong báo cáo.** [TASK-074b-4.report.md](../tasks/TASK-074b-4.report.md) ghi 32 test (20 + 12). Đếm thực tế: `grep -c "^\s*it("` cho ra 21 (activation) + 12 (wiring) = **33**. Có một test ở `operatorAutoActivation.test.ts:213` ("activates the renamed research-provider-terms skill") chưa có trong danh sách báo cáo. Sửa con số và liệt kê test đó. Test này thuộc TASK-151 (tên `research-provider-terms`, đã kiểm: dòng 213); ghi rõ trong báo cáo, không tính là test của 074b-4.

**6b. Ghi file sau khi DB đã active (finding 6, trung bình, đường operator).** Hiện `writeUserSkill` có thể lỗi sau khi transaction đã đưa bản mới thành `active`. `handbook.ts:118` yêu cầu operator đọc file kỹ năng, nên file thiếu nghĩa là operator đọc nội dung cũ hoặc không có. Cần làm một trong hai:
- Ghi file trước khi commit transaction kích hoạt, hoặc
- Ném lỗi bên trong transaction để DB quay lại nếu ghi file thất bại.

Chọn một và ghi lý do trong báo cáo. Test: ghi file thất bại → bản đích không ở trạng thái `active`, và bản cũ vẫn `active`.

**6c. Test buộc rollback (báo cáo 074b-4, rủi ro còn mở).** Hiện "flip-then-refuse rollback" không được test ép buộc. Thêm test: `checkAutoActivation` đã đổi `shadow → draft` rồi bị từ chối (AppError) → trạng thái DB quay lại đúng như trước.

**6d. Đánh dấu finding 9 là đã rút lại.** Ghi trong báo cáo 074b-4: "Finding 9 (archive vẫn định tuyến) được rút lại: `archived` chỉ được ghi ở `skillVersions.ts:158` trong cùng transaction với kích hoạt bản thay thế; `userSkills()` chỉ nạp file khi không có bản active." Không cần sửa code cho mục này.

**6e. Mở rộng ghi chú cho operator.** Trong báo cáo, ghi rõ chưa truy được đường dẫn file kỹ năng mà operator mở (`handbook.ts:85–129`, `workspace.ts:96–131`). Đây là việc chưa xác minh, không phải sửa code.

**6f. Giữ cờ tắt.** `autoActivateReadOnlySkills` giữ mặc định tắt. Không bật trong bất kỳ cấu hình nào trong lượt này.

## Việc 7 — TASK-150: HEALTHCHECK và DATA_DIR (ĐÃ BỎ)

**Bỏ theo advisor 2026-11-20.** Không sửa Dockerfile. Ghi nhận: HEALTHCHECK (`/data`) và worker (`./data`) lệch mặc định khi chạy ngoài image; trong image không lỗi vì `ENV DATA_DIR=/data`. Các bullet dưới đây là yêu cầu cũ, không còn hiệu lực.

- Dockerfile dòng 191: HEALTHCHECK dùng `process.env.DATA_DIR||'/data'`, còn worker dùng `resolvePath(env.DATA_DIR ?? "./data")` (`apps/server/src/node/agent.ts:173`). Hai mặc định không khớp khi chạy worker ngoài image. Trong image hiện tại không lỗi, vì `ENV DATA_DIR=/data` (dòng 113).
- Sửa để HEALTHCHECK dùng cùng quy tắc mặc định với worker. Nếu khó đồng bộ trong một dòng lệnh, ghi lý do và để nguyên, báo cáo.
- **Không** coi phần vận hành là xong nếu chưa có Docker. Ghi trong báo cáo: "chưa build image; chưa chạy HEALTHCHECK thật; `--start-period=90s` chưa đo". Nếu có Docker, build image, chạy HEALTHCHECK trong container, và ghi số đo.

## Kiểm tra bắt buộc

Trong `apps/server`:
- `npx tsc --noEmit` → exit 0
- `npx vitest run test/skillDraftChecks.test.ts test/proposeSkill.test.ts test/operatorShadow.test.ts test/operatorShadowGate.test.ts test/operatorAutoActivation.test.ts test/operatorAutoWiring.test.ts`
- Toàn bộ server suite một lần, exit 0. Nếu có timeout worker/preview, chạy lại các file đó riêng và ghi rõ.

Trong `apps/web` (chỉ nếu đổi `SkillVersions.tsx`): tsc và suite web.

## Ràng buộc

- Không tạo `.done`. Review bởi advisor sau khi xong.
- Không commit, không push, không tạo nhánh mới.
- Không ghi `data/app.db`. Không chạy `npm install`.
- Không xóa `C:/Users/defu/AppData/Local/Temp/shadow.bak.ts`.
- Không đưa API key hay token vào file nào.
- Nếu một mục không làm được, ghi "không làm" kèm lý do trong báo cáo, không báo là xong.

## Báo cáo

Viết `docs/tasks/TASK-152.report.md`:
- Từng Việc (1–7): làm gì, file nào, test nào, kết quả.
- Việc nào chưa làm và vì sao.
- Quyết định mặc định đã chọn (3d, 6b, Việc 7) và lý do.
- Kết quả test thật: số file, số test, exit code.
- Ghi "code chưa được review, chưa có `.done`".
