# TASK-134 — Phiên bản đầu vào và kết quả worker

## Thay đổi

- `apps/server/src/pipeline/dataContract.ts` khai báo bảng theo dự án, stage sở hữu và cách truy từ hàng dữ liệu về dự án. Bảng điều khiển như job, quyền agent, chi phí và xuất bản tách khỏi dữ liệu nội dung. Test đọc schema SQLite và kiểm tra bảng mới có `project_id` hoặc `scene_id` phải được khai báo.
- `apps/server/src/pipeline/inputVersion.ts` lấy SHA-256 của đầu vào từ các stage phụ thuộc, cài đặt dự án và nội dung tệp. Hàng và khóa JSON được sắp ổn định, bỏ mốc thời gian phụ và trường điều phối runtime. File được nhận diện theo nội dung trong dự án hoặc kho footage, kể cả khi đường dẫn được đổi. `ArtifactService` giữ hash khi nhận dạng tệp và dấu thay đổi vẫn khớp.
- `jobs/jobRepository.ts`, `pipeline/{orchestrator,invalidation}.ts`, Job/Stage DTO, `jobs/worker.ts` và `stages/render/renderExecutor.ts` lưu phiên bản khi xếp và bắt đầu job. Chốt hoàn tất giữ công việc với trạng thái SUCCEEDED rồi đưa bước về STALE khi đầu vào đổi. Chế độ chạy toàn bộ thử lại một lần khi các bước trước đã sẵn sàng. Bản render riêng vẫn dùng dữ liệu upstream hiện tại. Phiên bản đầu vào cũng được lưu khi duyệt cổng và nhận nội dung do người dùng cung cấp.
- `services/renderService.ts`, `publishing/publishService.ts` và RenderReport DTO giữ bản render đã lỗi thời trong lịch sử, đánh dấu để loại khỏi lựa chọn đăng và từ chối job đăng đã trỏ đến bản đó. Finalize render trả lại bản trùng ID và input hash nếu nó đã được ghi trước khi control khởi động lại.
- `node/{uploadStore,leaseService,nodeService,agent}.ts`, `api/nodes.ts` và `app.ts` lưu upload theo job và lease, với HEAD/PATCH tiếp tục từ byte đã lưu, `have` dùng lại tệp đúng mã băm trong dự án, ba lần thử có backoff và kiểm SHA-256 khi nhận đủ. PUT vẫn dùng được cho worker cũ. Quyền finalize được chiếm bằng một UPDATE có điều kiện trước thao tác ghi. Khi khởi động lại, control dùng pending bundle và upload đã xác minh để hoàn tất. Sweep giữ việc đang finalize và dọn upload tạm của việc kết thúc hơn 24 giờ.
- `apps/server/src/db/schema.ts`, migration Drizzle **0081_tiresome_quicksilver.sql**, snapshot và journal thêm cột phiên bản, cờ invalidated, dấu lần chạy lại và finalize, cùng bảng `node_uploads`. Lần generate kế tiếp báo không đổi schema.
- `PipelinePanel.tsx`, hướng dẫn quy trình, hướng dẫn máy worker, changelog và featureMap thêm cảnh báo đầu vào mới và hành vi tải tiếp.

## Đo phiên bản đầu vào

Fixture cục bộ lớn nhất dành cho phép đo có 240 cảnh và 240 tệp duy nhất, tổng 60 MiB, dùng dữ liệu tổng hợp trong thư mục tạm. Đo `RENDER` qua transaction SQLite trên Windows. Sau tối ưu kiểm dấu thay đổi tệp, lần nguội là 679,8 ms và sáu lần sau là 53,9–83,1 ms. Log nằm trong `tmp/task134-benchmark-final.log`.

Vượt 200 ms ở lần đọc nguội vì phải băm toàn bộ tệp chưa có trong bộ nhớ. Các lần sau dùng lại hash theo thiết bị, inode, kích thước, mtime và ctime. Các hàng SQLite vẫn được đọc để phát hiện cả các cập nhật giá trị không thay timestamp. Dùng mtime/rowid của bảng làm khóa bỏ qua toàn bộ hàng có thể bỏ sót loại thay đổi đó.

## Kiểm chứng và phạm vi

- `npm run typecheck`, `npm run build` và `npm test --workspaces -- --maxWorkers=2` đều đạt ở bản cuối. Shared 755, MCP 31, server 1.386 đạt và 6 skip, web 223. Log trong `tmp/task134-final-{typecheck,build,tests}.log`. Build có cảnh báo kích thước chunk Vite.
- Lượt kiểm tra đầy đủ đầu tiên phát hiện năm lỗi vì cài đặt legacy được lưu thêm mặc định và SCRIPT tự ghi treatment vào project. Phép băm nay chuẩn hóa cài đặt qua schema, đồng thời xem treatment là đầu ra của SCRIPT khi kiểm SCRIPT/RESEARCH. Các bước phía sau vẫn tính treatment vào đầu vào. Bộ 28 test nghiên cứu, kịch bản, timeout và phiên bản đầu vào đã đạt mà không đổi số lời gọi model mong đợi.
- Hai lượt kiểm tra tập trung đạt 52 test về worker và dữ liệu đầu vào, rồi 77 test về pipeline, worker và xuất bản. Test API đối chiếu phiên bản các bước DONE với phiên bản tính lại. Test xuất bản kiểm cả lúc xếp việc và lúc chuẩn bị gửi một bản dựng đã lỗi thời.
- Trình duyệt với API giả lập hiển thị cảnh báo lúc đang chạy, trạng thái STALE và nút chạy lại gửi đúng yêu cầu. Kích thước kiểm tra 1440 px và 375 px không tràn ngang. Log và ảnh nằm trong `tmp/task134-browser.log`, `tmp/task134-running.png` và `tmp/task134-stale-mobile.png`.
- Test API và worker dùng fixture, giả lập node và gọi Fastify bằng inject. Bao phủ upload dừng ở 40%, sai offset, tiếp tục sau khi tạo lại control, nhận tệp đã có, chặn lease hết hạn và hai yêu cầu hoàn tất đồng thời, khôi phục dấu finalize đã lưu. Test refetch giữ khoảng gia hạn khóa TTS có sẵn. Fixture kiểm dọn PUT nhìn vào thư mục của lease mới.
- Lấy ý tưởng phiên bản đầu vào từ Dagster và khóa cache của Bazel/BuildKit. HEAD/PATCH dùng phần offset của tus, cùng xác thực node và khai báo SHA-256 hiện có. Không triển khai các phần mở rộng tus. Không thêm dependency hoặc sao chép mã bên ngoài. [Đặc tả tus 1.0](https://tus.io/protocols/resumable-upload)
- Không chạy worker thật, model thật hay thao tác dự án được bảo vệ. Không commit/push theo chỉ dẫn người dùng.
