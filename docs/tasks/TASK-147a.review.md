# TASK-147a — Review ngày 2026-11-18

**Trạng thái: code/focused đã đạt sau small review fixes; chờ khép regression toàn workspace trước khi chấp nhận và giao147b/c.** Không commit/push. Marker triển khai không tự mở phụ thuộc.

## Đã kiểm

- Đọc guide147 phần147a, report, diff framework/service/assignments/schema/tests, visual adapter và wiring app. Visual context/validator vẫn gọi implementation cũ, supportedStages lấy từ adapters, claim lọc đúng role và maxConcurrent theo assignment/workspace. Channel manager bị loại. Unknown stage không được offer. Các stage mới default app, chỉ visual default app_then_agent.
- Legacy constructor đã có context/validator được giữ để các caller/test cũ dùng được; production app truyền visual adapter rõ ràng. New role skills cụ thể đi cùng147b/c/d khi triển khai adapters tương ứng, chưa tuyên bố đã có các stage đó.
- Supervisor đọc API route, tool risk và default modes; không migration/dependency mới trong147a. Typecheck/build baseline toàn repo đạt trước lượt fix, Drizzle No schema changes.

## Small review fixes của Codex

1. Constructor trước đó tạo implicit adapter có no-op validator khi callbacks đều thiếu. Đã cho supportedStages rỗng khi thiếu context hoặc validateComplete; không offer stage trong cấu hình không đủ gate. Một test negative mới chứng minh không handoff.
2. Regex quota ảnh còn áp cho mọi adapter. Đã giới hạn exception tương thích cũ cho VISUAL_SEARCH, để RESEARCH/custom adapter chỉ handoff theo error contract của mình. Một test custom RESEARCH/empty handoffErrors từ chối IMAGE_RATE_LIMIT ở max attempt.
3. Test rộng phát hiện hai writer tool của145 thiếu RESOURCE_MAP. Đã thêm project lease cho switch_script_hook/rescore_script, không nới assertion; review145 vẫn chưa accepted vì các finding riêng.

## Bằng chứng

- `tmp/codex-review-147a-visual-tests.log`: 13 file,143 đạt/1 lỗi; lỗi duy nhất RESOURCE_MAP nêu trên. Bộ chọn file có cả supervision vì tên chứa vision; không coi đó là test riêng147a.
- Sau mapping fix: `tmp/codex-review-147a-core-rerun.log`,4file/77 test đạt.
- Sau hai guard fixes: `tmp/codex-review-147a-guards.log`,4file/**79 test đạt**, maxWorkers2; không dùng network hay provider thật.
- `tmp/codex-supervisor-round2-typecheck.log`, `...-build.log`: toàn repo đạt; Vite có cảnh báo chunk lớn. `...-drizzle.log`: No schema changes.
- Full server đang chạy `tmp/codex-supervisor-round2-server.log`; shared/MCP/web đang chạy `tmp/codex-supervisor-round2-other-workspaces.log`. Kết quả được chốt khi process kết thúc; không dùng trạng thái file log làm bằng chứng process đã dừng.

Shared/MCP/web đã kết thúc: shared781 đạt, MCP49 đạt, web228 đạt/3 lỗi. Ba lỗi là PipelinePanel budget estimate, ProjectDetailPage overview và CreateProjectDialog budget preview; chưa khép nguyên nhân nên chưa dùng để kết luận nghiệm thu147a. Full server vẫn được theo dõi bằng handle thật, không restart vì log tạm thời yên.

Giữ147b/c/d trong queue tới khi Codex cập nhật verdict sau regression. Nếu chỉ có lỗi thuộc worker khác, phải phân loại cụ thể thay vì quy tất cả là unrelated hoặc bỏ qua.

## Cập nhật regression (2026-11-18, sau Vòng 32)

- Server đầy đủ: 1704 pass, 8 skip, 0 fail. Shared 788 pass. MCP 49 pass. Web 235 pass (lần trước 3 lỗi budget không còn tái hiện).
- Verdict 147a: **chấp nhận** cho nền tảng agent stage (lease, fence, handoff). Review 145 vẫn tách riêng, chưa chấp nhận theo dòng trên.
- 147b và 147c được giao sau mục này.
