# TASK-129b report: Resource Governor (điều tiết tài nguyên máy)

## Những việc đã làm
- `apps/server/src/jobs/resourceGovernor.ts` (mới):
  - Phân loại 4 nhóm stage: `cpu` (render, clip, timeline, subtitle), `gpu`, `io` (visual/media/music search, publish, voice), `llm` (topic, research, script, scene_plan, visual/music review, assistant).
  - Bộ lấy mẫu `createSystemSampler` (5s/lần) đo CPU (`os.cpus()`), RAM, Disk trống (> 5 GB), GPU (`nvidia-smi` nếu có).
  - Thuật toán AIMD: tăng 1 slot khi có việc chờ và máy còn trống trên 5% khoảng đệm; giảm 50% slot (floor = min) khi máy vượt ngưỡng 85% CPU/RAM, 90% GPU hoặc đĩa trống < 5 GB.
  - LLM Cooldown: nhận diện và giữ slot nhóm `llm` khi provider AI bị hạ nhiệt, giảm một nửa khi bắt đầu cooldown (`// TASK-127`).
  - Anomaly `resource_starved`: cảnh báo việc chờ > 15 phút do hết slot chạy, gợi ý thêm node hoặc tăng giới hạn.
  - Bus event `capacity_idle`: phát sự kiện khi máy rảnh rỗi > 10 phút để hỏi duty agent, không tự ý tạo topic hay vượt ngân sách.
- `apps/server/src/jobs/worker.ts`: Chuyển sang xin slot theo class từ governor thay vì so sánh concurrency cố định. `WORKER_CONCURRENCY` và `RENDER_CONCURRENCY` giữ vai trò trần trên.
- `apps/server/src/lib/config.ts` & `.env.example`: `WORKER_CONCURRENCY` mặc định là `min(32, cores * 2)`.
- `apps/server/src/api/resources.ts` & `app.ts`: Endpoint `GET /api/resources`, `GET/PUT /api/settings/governor`, khởi động và dừng governor theo vòng đời server.
- `apps/server/src/operator/supervisor.ts`: Thêm `resource_starved` vào danh sách giám sát.
- Web:
  - `apps/web/src/features/dashboard/ResourceCard.tsx`: Thẻ "Tài nguyên" trên Dashboard hiển thị live CPU, RAM, Disk, GPU và slot từng nhóm.
  - `apps/web/src/features/settings/GovernorSettingsCard.tsx`: Cài đặt bật/tắt và min/max từng class tại `Cài đặt → Render` (`#tai-nguyen`).
- Tài liệu & Hướng dẫn:
  - `docs/user-guide/tai-nguyen-may.md`: Trang hướng dẫn người dùng chi tiết cơ chế AIMD, các nhóm việc, cảnh báo và cách cấu hình.
  - `packages/shared/src/features/featureMap.ts`: Thêm `"tai-nguyen-may"` vào `GUIDE_PAGES` và đăng ký feature `resource-governor`.
  - `docs/user-guide/README.md` & `nhat-ky-thay-doi.md`: Cập nhật mục lục và nhật ký thay đổi cho `TASK-129b`.

## Sai lệch / Ghi chú kỹ thuật (Deviations)
- Nhóm `llm` dùng trần cấu hình tĩnh và cooldown (`// TASK-127`), nhóm `agent` chưa đưa vào do chờ TASK-128 (`// TASK-128`).
- Bước `VOICE` hiện mặc định xếp vào `io` (chưa đấu nối phân luồng cục bộ cpu/gpu cho Piper/VieNeu).
- Không cần migration cơ sở dữ liệu (cài đặt lưu trong `app_settings` dưới khoá `governor.settings`).
- Sự kiện `capacity_idle` chuyển thông tin profile qua `summary` và `link` do schema của `agentEvents` là strict.

## Kết quả kiểm thử (Verification)
- `npm run typecheck`: Sạch 100% trên cả 4 workspace (`@vg/shared`, `@vg/mcp`, `@vg/server`, `@vg/web`).
- `packages/shared`: 739/739 tests pass.
- `apps/mcp`: 22/22 tests pass.
- `apps/web`: 206/206 tests pass (bao gồm 5/5 test độ phủ tài liệu `guideCoverage.test.ts` và 2/2 `ResourceCard.test.tsx`).
- `apps/server`: 20/20 tests `resourceGovernor.test.ts` pass hoàn toàn.
