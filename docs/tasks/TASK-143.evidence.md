# TASK-143 — bằng chứng đo lại (2026-11-18)

Phạm vi: đính chính P2 trong `TASK-143.review.md`. Không commit, không push, không migration.

## 1. Restore Litestream thật (file replica)

Chạy thật bằng image `litestream/litestream:0.3.13` trên Docker Desktop, cấu hình từ `deploy/docker/litestream.yml` (không sửa). Replica là thư mục tệp (`file:///data/replica`), không dùng S3.

Các bước:
1. Tạo DB từ migration thật (`apps/server/drizzle`, 88 migration, 138 bảng app) và 1 project.
2. `replicate` trong container, chờ 12 giây, `docker stop` (Litestream đồng bộ lần cuối khi dừng). Kết quả: snapshot và WAL segment được ghi vào `replica/generations/`.
3. `restore -o restored/app.db file:///data/replica` vào thư mục mới. Kết quả: exit 0, integrity_check = ok.
4. So sánh với DB nguồn: 138 bảng app khớp; `projects` = 1; `__drizzle_migrations` = 88. Khác biệt duy nhất là `_litestream_lock` và `_litestream_seq` do Litestream tự tạo trong DB được replicate.
5. Snapshot thế hệ thứ hai (KHÔNG phải đo độ trễ replica): ghi thêm 1 project, replicate lại, restore lại. Dòng mới có mặt trong bản restore, integrity_check = ok. Litestream mở một generation mới ở lần chạy thứ hai, vì DB đã được mở ngoài Litestream giữa hai lần.
6. Khởi động app trên DB đã restore: mở bằng better-sqlite3, chạy migrate; số migration trước và sau đều là 88 (không có gì phải áp dụng lại).

Lưu ý: đây là file replica, không phải S3. Lần đo chỉ có một lần chạy, không có độ trễ liên tục được đo.

## 2. `restore-drill.sh` có kiểm schema

- Thêm kiểm tra bảng bắt buộc (`projects`, `jobs`, `__drizzle_migrations`). Thiếu bảng thì thoát 1 với thông báo; trước đây in SUCCESS cho mọi tệp SQLite.
- In số dòng của ba bảng trên.
- Đã chạy 3 trường hợp:
  - fixture tự sinh: PASS (exit 0);
  - tệp SQLite không phải app (`other`): FAIL (exit 1, `MISSING:projects,jobs,__drizzle_migrations`);
  - DB restore thật từ Litestream: PASS (`projects=2`, `jobs=0`, `__drizzle_migrations=88`).
- Nhánh snapshot bằng `cp` vẫn còn, nhưng không được dùng làm bằng chứng Litestream.

## 3. Đo tải lại

- `apps/server/test/load/controlPlaneLoad.ts` đã sửa: bỏ async IIFE không await, xóa profiler sau khi đăng ký node, đo `event-loop` và thêm số heartbeat, usage, job.
- Chạy có cờ `RUN_LOAD_TEST=1`. Kết quả thô: `TASK-143.load-2026-11-18.json`.
- Số đo chính: 5–300 node, p95 0.24–0.34 ms, `SQLITE_BUSY` = 0. Chi tiết và giới hạn đã nêu trong `docs/ARCHITECTURE.md` mục 12.
- Thông lượng đo được 3.900–6.500 câu lệnh/s trong đợt ngắn một luồng. Không còn công bố "3.000–5.000 writes/s" hay "250–300 node".

## 4. Chưa làm / ngoài phạm vi

- Hai máy thật qua mạng: chưa chạy.
- Tải kéo dài, nhiều tiến trình ghi đồng thời, và lặp lại để lấy phương sai.
- Độ trễ replica Litestream dưới tải: chưa đo.
- Drill chạy thật trên S3/MinIO: chưa chạy (không có credential và không cần thiết để kết luận restore cục bộ).
