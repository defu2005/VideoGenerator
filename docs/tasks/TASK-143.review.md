# TASK-143 — Review chính thức, 2026-11-18

**Verdict: chưa chấp nhận.** Đã đọc guide/report, DB profiler/connection/checkpoint, audit/usage batching, load runner và restore drill. No migration; không commit/push.

## [P1] Lỗi flush transaction làm mất usage đã nhận vĩnh viễn

`pipeline/orchestrator.ts::flushUsage` xóa mọi entry khỏi pendingUsage **trước** repository.atomic, không phục hồi khi transaction thất bại. Background timer lại catch/ignore lỗi. Sau SQLITE_BUSY/ghi lỗi, token/cost đã nhận không còn trong RAM cũng không nằm trong DB, kể cả tiến trình tiếp tục và shutdown sạch.

Repro offline `npx tsx tmp/codex-review-143-flush-loss.ts`, log cùng tên `.log`: queuedBefore1; inject transaction failure; queuedAfterFailure0; flush lại thì usageAfterRetry=null. Không dùng provider hay dữ liệu thật. Cần dequeue sau commit hoặc hoàn trả batch đúng thứ tự khi lỗi, không double count khi retry; tương tự audit/terminal paths phải được kiểm. Đây không phải cửa sổ mất dữ liệu do crash1–2s đã chấp nhận.

## [P2] Chưa có bằng chứng restore Litestream thật

Report ghi thành công một fixture tự tạo và một file snapshot copy. Script dùng cp cho hai trường hợp đó; không chạy Litestream replicate/restore. Guide yêu cầu ít nhất một lượt genuine local MinIO **hoặc file replica**, nên thiếu S3 credential không phải bằng chứng đã hết phương án local. Hiện chưa có replica lag, row counts các bảng chính hay khởi động app trên DB đã restore. Script chỉ in các tên bảng tìm thấy mà không fail khi thiếu bảng, nên có thể in SUCCESS cho SQLite DB không phải app. Cần test negative schema và số liệu restore chính xác; không gọi copy file là nghiệm thu Litestream.

Two-machine runbook có nhưng report chỉ nêu mock worker suite; chưa có runlog hai container trên một host và các failure drill có thể chạy. Nếu môi trường thực sự thiếu runtime/binary, ghi rõ requirement chưa đạt và bằng chứng availability, không kết luận tất cả checklist đã hoàn tất.

## [P2] Số đo giới hạn không chứng minh mức tải được tuyên bố

Load runner dùng async IIFE không có await trong body, do đó từng vòng heartbeat/usage chạy xong tuần tự trước Promise.all. Profiler chưa reset sau migration/setup/node registration; duration chỉ tính đoạn sau setup, nhưng percentiles/counts chứa cả setup. Chưa đi qua real relay/accounting batch path (insert trực tiếp llm_relay_usage). Không có bằng chứng trước/sau hot-write fixes hay mức p95 vượt50ms.

Con số3.000–5.000 writes/s và dự báo250–300nodes trong ARCHITECTURE/report không xuất phát từ các bảng đo đã cung cấp. Cần phân biệt statement throughput, durable writes và số node; đo workload có nhịp gửi/claim/flush thực tế, ghi rõ concurrency, thời gian, retries và event-loop delay. Nếu chưa tới điểm saturation thì ghi 'chưa đo', không suy ra ngưỡng node như dữ kiện đã kiểm.

## Kiểm chứng / hướng xử lý

- Supervisor baseline typecheck và build toàn repo đạt ở `tmp/codex-supervisor-round2-typecheck.log` / `...-build.log`, canonical Drizzle No schema changes. Không coi những check này là bằng chứng flush/restore đúng.
- Test source mới có9 ca, nhưng mock retry đơn giản/explicit stop chưa bắt transaction-failure mất queue nêu trên. Yêu cầu thêm rollback+retry+clean shutdown và terminal/cancel tests trên temp DB.
- Quyền admin DB-stats, card, docs và featureMap hiện có; location Render/System khác guide cần ghi rõ, không tuyên bố không có deviation.
- Xếp `tmp/worker143-fix1.md` sau slot đang chạy141,145fix1,138/139fix2. Không giao thêm feature dựa trên đo capacity chưa được xác minh.

## Sự kiện fix1 — 2026-11-18: chưa hoàn tất, không nghiệm thu

Đã đọc event1fadae95-ae1b-4163-97fd-7269cefa9082 và run record. Wrapper PID4496 đã thoát; event ghi exit1, FreshReport:false, FreshMarker:false, ReadyForReview:false. Hai tệp TASK-143.fix1.report.md và TASK-143.fix1.done đều không tồn tại. Log task rỗng; wrapper stderr ghi NativeCommandError ở lời gọi opencode-cli. Không có kết quả fix1 để review/accept; review implementation trước vẫn chưa đạt.

Windows PowerShell đã biến native stderr thành lỗi kết thúc do ErrorActionPreference Stop. Wrapper đã được sửa ở lượt trước để dùng Continue trong lời gọi native và lấy exit code thật; tests hook hồi quy đã qua (tmp/codex-hook-review-tests-after-stderr-fix.log). Điều này không chứng minh task143 đã chạy thành công hoặc đã sửa các finding. Không tính lỗi khởi chạy này là một bản implementation fix bị review thất bại.

Đã kiểm working tree: các file db/client, auditLog, orchestrator và nhiều thay đổi task khác còn dirty; không suy ra chúng do lần fix1 này tạo ra, không revert và không commit. Không chạy test sản phẩm cho một bản fix không có report/marker.

Người dùng yêu cầu kết thúc các phiên hiện tại rồi chờ, không giao thêm. Không restart/retry/replacement TASK-143 và không giao task mới. Goal giữ PAUSED. Task143 còn pending chờ chỉ đạo; callback này đã xử lý, không gửi lại event.
