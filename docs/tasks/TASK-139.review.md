# TASK-139 — Review chính thức, 2026-11-17

**Verdict: chưa chấp nhận.** Codex review theo vai trò mới của người dùng; không commit/push.

## Finding cần sửa

### [P1] Preview dùng compose plan cũ sau khi timeline đã đổi

`preview/planSource.ts`, `fromTimeline`, nhận `render/compose-plan.json` nếu `saved.aspect === aspect`. Không kiểm plan được sinh từ timeline/đầu vào hiện tại, và không đối chiếu duration/source. Cache key sau đó băm **shot cũ** trong plan cũ nên không giải quyết được sai đầu vào này.

**Đã tái hiện offline** bằng `npx tsx tmp/codex-review-139-repro.ts`, với cả timeline và saved compose plan hợp lệ theo schema. TIMELINE được đặt DONE; scene giữ nguyên id và aspect:

- Timeline hiện tại: ảnh `visuals/new.jpg`, duration 4 giây.
- Preview trả `basis: timeline` nhưng shot vẫn dùng `visuals/old.jpg`, duration 2 giây.
- `reusedStalePlan: true`; log `tmp/codex-review-139-repro.log`.

Người dùng kiểm crop/hình/nhịp sau khi sửa sẽ xem nhầm nội dung trước đó. Cần ràng buộc saved plan với fingerprint của đầu vào hiện hành, hoặc dựng lại khi không có bằng chứng plan còn hợp lệ. Bảo toàn shot chỉnh tay/locked theo semantics hiện có; không tìm stock hoặc gọi LLM khi preview. Saved plan lỗi JSON/schema hay thiếu scene phải có fallback rõ thay vì toàn bộ preview hỏng/âm thầm thiếu cảnh.

Thêm regression đi qua **loadPreviewPlan thật**, không inject `planLoader`: ảnh thay, scene duration/order thay, thêm/xóa scene, plan JSON/schema hỏng và plan chưa có fingerprint. Assert kết quả theo timeline hiện tại và state/inputVersion không đổi.

## Hiệu năng fallback

Report đã công khai fallback full-shot mất 11,566 giây cho một khung, vượt target 3 giây. Đường trực tiếp dùng adapter Chromium chụp đúng thời điểm; fallback dựng cả shot rồi mới lấy frame nên chậm. Số đo lạnh trước đó (QUALITY 1,553/4,974/5,056 giây cho frame/sheet/clip) chứng minh đường trực tiếp trên fixture đã đo, **không chứng minh fallback đạt target**.

Worker phải kiểm lại cơ chế chọn adapter, không âm thầm coi fallback là fast path. Ghi rõ giới hạn/ghi chú khi fallback thực sự được sử dụng; tối ưu phạm vi render nếu khả thi mà giữ đúng hình RENDER. Không thêm dependency hay download browser. Không nới ngưỡng kiểm thử để che vấn đề. Hiệu năng fallback chưa đạt vẫn phải nằm trong report sau sửa.

Đo lại trong lượt review này bằng runner fixture sẵn có: `npx tsx tmp/task139-preview-benchmark.ts direct frame` và `legacy frame`, lần lượt **32,600 s** và **51,993 s**. Log `tmp/codex-review-139-cold-direct.log`, `tmp/codex-review-139-cold-fallback.log`. Máy đang đồng thời chạy workspace suites và ba worker opencode; fixture không gắn governor. Đây là số đo dưới tải đồng thời, không phải baseline CPU nhàn và không đủ để quy mức chậm cho riêng preview. Cả hai đều vượt target trong điều kiện đã đo; cần đo lại ở điều kiện tải được ghi rõ sau sửa.

## Kiểm chứng và giới hạn

- Đã đọc guide/report, planSource/service/shotRenderer/facts/toolDefs, API, UI, MCP image diff và test. **5 file / 55 test tập trung đạt**, gồm 18 preview test; log `tmp/codex-review-138-139-focused.log`. Các test service chủ yếu inject plan nên không bắt stale saved plan trên.
- Đã đối chiếu log cold timing cũ và docs; chưa chạy lại browser/cold benchmark trong lượt này. Không dùng artifacts cũ để nghiệm thu bản sửa.
- Drizzle ở bản sao metadata: `No schema changes`; TASK-139 không có migration/dependency mới. Chi tiết/lệnh ở TASK-138.review.md.
- Typecheck toàn repo **chưa đạt** do các worker143/145/147a đang sửa; không thấy diagnostic GC/preview trong lượt đó. Log `tmp/codex-review-138-139-typecheck.log`.
- Full workspace suites hai worker đã kết thúc exit1: shared 765 đạt / 16 lỗi; MCP 49 đạt; server 1.542 đạt / 27 lỗi / 7 skip; web 224 đạt / 4 lỗi. Log `tmp/codex-review-138-139-workspaces.log`. Chưa phân loại nguyên nhân từng lỗi của working tree đang thay đổi; chưa xác nhận build hiện tại.
- Đã thấy guide tiếng Việt, featureMap, changelog, ARCHITECTURE, skill `video-xem-truoc-nhanh`; ba tool là read và protected project bị từ chối trước khi prepare. Các giới hạn DOM/ước tính đã ghi rõ.

## Xử lý

Giao opencode theo `tmp/opencode-task138-139-fix-brief.md` khi có slot. Chưa accepted; marker `.done` cũ là trạng thái triển khai trước review này. Sau sửa cần kiểm cả plan freshness và cache invalidation, browser fixture, timing và suites theo guide.

## Review bản fix1 — 2026-11-18, vẫn chưa chấp nhận

Đã đọc report/source fix1. Có schema guard cho saved plan, kiểm scene ids/order/duration và ghi chú full-shot fallback. Tuy nhiên `isSavedPlanCurrent` mới chỉ so still shots với **visual IMAGE đầu tiên** khi visual đó tồn tại.

**[P1] Xóa ảnh khỏi timeline vẫn xem lại ảnh cũ.** Khi timeline chuyển sang PLACEHOLDER, `tlVisual` không có, toàn bộ kiểm source bị bỏ qua, saved still plan cũ vẫn được trả về. Repro offline `npx tsx tmp/codex-review-139-cleared-image.ts`, log cùng tên `.log`: current timeline `path:null`, duration2; actual preview `path:visuals/old.jpg`, duration2, `reusedStalePlan:true`.

Không có fingerprint xác thực đầy đủ; thay nội dung graphic, motion, FPS hoặc visual thứ hai trong cùng scene cũng chưa được bảo vệ bởi phép so hiện tại. Cần đối chiếu mọi đầu vào quyết định plan, hoặc mặc định rebuild khi thiếu bằng chứng freshness. Không coi `locked` là quyền tự động tái dùng mọi dữ liệu cũ, phải giữ đúng semantics của render. Test phải qua loadPreviewPlan thật và bao gồm remove-image, nhiều visual, graphic text/motion/FPS.

Worker đo direct frame 2,412s và fallback 25,023s, đồng thời thừa nhận fallback chưa đạt3s. Cần đọc đơn vị trong report là 2.412/25.023 giây, không phải 2.412/25.023 mili-giây. Chưa nghiệm thu hiệu năng fallback. Baseline typecheck/build round2 đã đạt, nhưng correctness P1 còn mở nên chưa accepted.

## Review fix2 — 2026-11-18: chưa chấp nhận

Đã xác minh cùng event fix2 exit0, report và marker mới; đọc planSource và tests.37test GC/preview đạt (tmp/codex-review-138-139-fix2-focused.log). Trường hợp xóa ảnh thành PLACEHOLDER đã có guard mới.

**P1 freshness chưa đầy đủ:** isSavedPlanCurrent so path/candidate membership, duration, aspect và FPS scene đầu nhưng không so motion. Graphics chỉ kiểm có graphic shot, không so text/payload. Set membership cũng không chứng minh thứ tự/timing/đủ mọi visual. Vì vậy chưa có complete fingerprint hay conservative rebuild theo brief.

Repro độc lập mới: npx tsx tmp/codex-review-139-fix2-motion.ts; output tmp/codex-review-139-fix2-motion.log. Timeline hợp lệ dùng cùng ảnh/candidate, duration2s và kenburns zoom1→1.2; saved shot không locked là static. loadPreviewPlan thật trả basis:timeline nhưng source.motion:static, reusedStalePlan:true. Không network/model, DB/files OS-temp; không mutate stage sản phẩm. Lỗi không còn chỉ là ảnh bị xóa mà là preview không phản ánh chuyển động đang duyệt.

Fallback25.02s vẫn công khai vượt3s; không đo lại trong lượt này. Không dùng focused pass hay baseline build cũ để chấp nhận correctness sai. Đây là fix2 vẫn chưa đạt; không giao vòng thứ ba. Người dùng yêu cầu chờ sau các phiên hiện tại và không giao thêm. Giữ pending, không commit/push/promote.
