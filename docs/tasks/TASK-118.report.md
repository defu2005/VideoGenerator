# TASK-118 báo cáo: máy worker v1

## Đã làm
- Tách render thành `prepare` (control) → `executeRender` (không DB/LLM/vault) → `finalize` (control). Chạy local giữ đường dẫn và hash cũ; có test vàng (`renderSplit.golden.test.ts`).
- Bảng `nodes`, `node_join_tokens`, `artifacts` và cột lease trên `jobs`: một migration `0068_adorable_venom.sql` do drizzle-kit sinh. Chạy generate lần hai: "No schema changes".
- Mã tham gia `vgj_…` (1 giờ, dùng một lần, chỉ lưu hash), token máy `vgn_…` (chỉ lưu hash). Mã sai/đã dùng/hết hạn đều trả 401 `INVALID_JOIN_TOKEN`.
- Lease có fencing: `lease_id`, heartbeat 15 giây, lease 60 giây; sai lease → 409 `LEASE_STALE` và xoá file đã tải lên. Quét hết hạn mỗi 10 giây → `NODE_LOST` (retry). Máy im 45 giây → offline.
- Tệp trao đổi theo sha256: tải xuống chỉ khi nằm trong manifest của job và đúng lease; tải lên kiểm sha256 và giới hạn kích thước (422).
- Cài đặt `nodes.remoteRender` off/prefer/only (mặc định off, chờ 30 giây). `off` giữ nguyên đường local.
- Agent `VG_ROLE=worker` (`src/node/agent.ts`) không DB: lưu token 0600, cache artifact LRU, backoff, 401 → xoá token và thoát mã 0, SIGTERM chờ rồi báo `NODE_SHUTDOWN`, từ chối `http://` công khai.
- Web: khối "Máy worker (thử nghiệm)" trong trang Render (file riêng), mục Ctrl+K, tài liệu `may-worker.md`, `featureMap`, nhật ký thay đổi.

## Docker (kiểm theo tài liệu)
`restart: on-failure` chỉ khởi động lại khi thoát mã khác 0 (tài liệu Docker, mục restart policies); thoát mã 0 thì không. Máy bị thu hồi thoát 0 nên nằm yên. Đây là kiến thức từ tài liệu, chưa chạy container thật trong phiên này.

## Kiểm tra
- `npm run typecheck` gốc: sạch. Vitest: server 1076 đạt (5 bỏ qua), shared 721, mcp 22, web 193 đạt.
- Web: `MetadataPanel.test.tsx` rớt một lần khi chạy song song toàn bộ, đạt khi chạy riêng (không liên quan task này).
- 18 test node mới (`workerNodes.test.ts`): join một lần, thu hồi, fencing 409, quét `NODE_LOST`, sha256, tên tệp, hoàn tất, placement; 5 test agent (`workerAgent.test.ts`). Không mạng, không ffmpeg thật.

## Lệch ranh giới / quyết định
1. `auth/guard.ts`: thêm một dòng cho phép tiền tố `/api/nodes/agent/` (route tự xác thực bằng token máy). Không sửa file auth khác.
2. `auth/routePermissions.ts`: chỉ thêm `ANY /api/nodes*` → `nodes.manage` (ADMIN, OWNER).
3. `pipeline/orchestrator.ts`: `resumeRunningJobs` và `requeueRunningJobs` bỏ qua job đang có lease sống.
4. Giới hạn join 10 lần/phút/IP nằm trong bộ nhớ.
5. Phiên bản app lấy từ `apps/server/package.json` (gốc không có version).
6. Thu hồi/hết hạn xếp lại qua `failJob` (có backoff), không tức thì. Job remote chiếm slot `RENDER_CONCURRENCY`.
7. Lỗi đóng gói bundle (rò đường dẫn/bí mật) làm job fail `NODE_BUNDLE_FAILED`, có thể thử lại.
8. Thumbnail/phụ đề/credits do node gửi được nhận nhưng bỏ; control tự tạo.

## Chưa làm / chưa kiểm
- Kiểm năng lực chỉ thử `ffmpeg -version` và tìm gói hyperframes, chưa mở trình duyệt thật.
- Chưa chạy agent thật với ffmpeg và HyperFrames, chưa chạy thủ công trên `DATA_DIR` tạm.
- Danh sách job trên web chưa hiện tên máy (JobSchema đã có `nodeId`).
- Không hiện tên máy tại trang dự án; không có công cụ registry nào tạo mã hay thu hồi máy (đúng yêu cầu).

## Tệp chính
`apps/server/src/node/{agent,nodeService,leaseService,artifactService,remoteBundle,placement,settings,tokens}.ts`, `api/nodes.ts`, `render/{types,executeRender,appVersion}.ts`, `services/renderService.ts`, `jobs/{jobRepository,worker}.ts`, `db/schema.ts`, `drizzle/0068_*`, `packages/shared/src/schemas/{node,renderBundle}.ts`, `apps/web/src/features/settings/WorkerNodesCard.tsx`, `deploy/docker/compose.worker.yml`, `deploy/{README.md,install.sh}`, `docs/user-guide/may-worker.md`.
