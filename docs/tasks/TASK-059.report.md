# Báo cáo tiến độ TASK-059

## Phần 1 · Mức tự chủ và quyền

- Shared lưu hợp đồng, preset, phép giao quyền và phân loại công cụ trong `packages/shared/src/schemas/autonomy.ts`. Export qua `packages/shared/src/index.ts`. Test trong `packages/shared/test/autonomy.test.ts`.
- Server dùng bảng `app_settings` hiện có. Mã nằm ở `apps/server/src/operator/autonomy.ts`, `apps/server/src/api/autonomy.ts`, `apps/server/src/app.ts`, `apps/server/src/registry/policy.ts` và `apps/server/src/registry/invoke.ts`. Test trong `apps/server/test/autonomy.test.ts` và `apps/server/test/registry.test.ts`.
- MCP chặn gọi API thô để đổi quyền, xoá dữ liệu vĩnh viễn, duyệt cổng hoặc đăng video. Registry giữ bước xác nhận của người dùng. Thay đổi trong `apps/mcp/src/tools.ts` và `apps/mcp/test/tools.test.ts`.
- Web có biểu mẫu và xác nhận Toàn quyền trong `apps/web/src/features/operator/AutonomySettingsPanel.tsx`, dùng tại `OperatorPage.tsx` và `apps/web/src/features/profiles/ProfileDetailPage.tsx`. Nhãn đường dẫn trong `apps/web/src/components/layout/Breadcrumbs.tsx`. Test tại `AutonomySettingsPanel.test.tsx` và `apps/web/src/features/help/guideCoverage.test.ts`.
- User guide cập nhật `docs/user-guide/tu-van-hanh.md`, `docs/user-guide/README.md`, `docs/user-guide/tro-ly-va-telegram.md`, `docs/user-guide/nhat-ky-thay-doi.md` và `packages/shared/src/features/featureMap.ts`.

## Phạm vi đã kích hoạt

- Hồ sơ chưa cấu hình ở mức Trợ giúp. Cấu hình đã lưu theo hồ sơ bị giới hạn bởi trần của app. Quyền chủ đề cho phép bỏ bước duyệt riêng khi xoá mục trong hàng đợi nếu app và hồ sơ cùng cấp quyền và tự động hoá đang hoạt động.
- Các grant còn lại được lưu và tính quyền hiệu lực. Việc bỏ xác nhận cho duyệt cổng, đăng bài, điều khiển màn hình và thay đổi nhà cung cấp chưa được kích hoạt. Các phần ngân sách, kiểm tra chất lượng và hoàn tác cần hoàn thành trước.
- Luồng lưu quyền kiểm tra loopback, nguồn trình duyệt cùng origin và chặn header nguồn công cụ. Đây là lớp kiểm soát cho app cục bộ hiện tại. Repo chưa có phiên đăng nhập chủ sở hữu riêng để phân biệt các tiến trình cục bộ có khả năng tự tạo HTTP header.
- Cập nhật kỳ vọng của test registry vì MCP nguồn `agent` giờ tạo thẻ chờ người dùng duyệt khi yêu cầu xoá vĩnh viễn dự án. Cập nhật test bao phủ hướng dẫn vì có tab hồ sơ mới.

## Mã nguồn mở

Tái dùng SQLite và registry của app. Dùng Hermes Agent làm tham chiếu thiết kế theo guide, không sao chép mã hoặc thêm phụ thuộc. Kiểm tra OpenAPI OmniRoute v3.8.53 thuộc phần 7 và chưa thực hiện.

## Kiểm tra

- `npm run typecheck` và `npm run build` đã qua.
- Hai lượt `npx drizzle-kit generate` đều báo `No schema changes`.
- Chromium headless với bản web build, API Fastify và SQLite tạm đã lưu mức Toàn quyền của hồ sơ, hiển thị hộp xác nhận, và giữ quyền hiệu lực là Trợ giúp theo trần của app sau khi tải lại.
- Lượt test tập trung qua 11 test server cho quyền và registry, 19 test MCP, và 6 test web cho biểu mẫu cùng bao phủ hướng dẫn.
- Tổng hợp theo workspace với `--maxWorkers=2 --testTimeout=30000 --hookTimeout=30000` có Shared 350 qua, MCP 19 qua, Server 731 qua và 1 bỏ qua, Web 172 qua. Lượt workspace đầu đọc policy cũ trong lúc test mới được sửa. Sau khi chốt mã, cả test policy riêng và bộ server đầy đủ chạy lại đều qua.

## Phần 2 · Chặn lặp và theo dõi ngân sách

- Registry của lượt operator được quản lý dừng lần gọi thứ ba có cùng công cụ và tham số. Sau ba lượt khác nhau thất bại trong sáu giờ, thao tác bị chặn ở lượt tiếp theo. Dùng chung cách tạo dấu vân tay với checkpoint, lưu thời điểm thất bại và ghi nhận sự cố có khoá chống trùng. Mã trong `apps/server/src/operator/loopGuard.ts`, `apps/server/src/operator/checkpoints.ts`, `apps/server/src/registry/invoke.ts` và `apps/server/src/db/schema.ts`.
- Drizzle sinh `apps/server/drizzle/0050_faulty_sally_floyd.sql`, snapshot và journal cho bảng lượt thử và bảng sự cố supervisor. Lượt generate thứ hai báo `No schema changes`.
- `get_autonomy_status` đọc quyền và chi phí đã ghi nhận theo ngày/tháng của toàn app và hồ sơ. Tái dùng số liệu job, cộng chi phí nhập tay USD/VND và loại mục sao chép từ usage. Mã trong `apps/server/src/assistant/tools.ts`, `apps/server/src/operator/autonomyBudget.ts`, `apps/server/src/services/usageService.ts` và `packages/shared/src/schemas/autonomy.ts`.
- Typecheck qua. Test tập trung có 14 test server, 5 test bao phủ hướng dẫn và 2 test shared qua. Test server kiểm tra chặn lần thứ ba ở registry, chống trùng sự cố, cửa sổ sáu giờ và ngưỡng chi phí 80%/100%.
- Circuit breaker lưu lịch sử theo hồ sơ và bước trong `app_settings`, ghi sự cố khi mở và đưa trạng thái vào `get_autonomy_status`. Worker giữ job bị chặn trong hàng đợi và có thể lấy job của hồ sơ khác. Lượt thử được nhận cùng giao dịch bắt đầu job. Lỗi tăng thời gian chờ gấp đôi đến tối đa 24 giờ. Thành công đóng breaker. Mã trong `apps/server/src/operator/circuitBreaker.ts`, `apps/server/src/pipeline/orchestrator.ts`, `apps/server/src/jobs/jobRepository.ts` và `apps/server/src/jobs/worker.ts`.
- Hai test mới bao phủ chuỗi ba lần lỗi, tỉ lệ lỗi trên mười lần, hàng đợi qua hồ sơ khác, một job thử, tăng thời gian chờ và đóng sự cố. Typecheck qua. Bộ registry/autonomy/pipeline API có 18 test qua và bộ worker có 6 test qua. Circuit breaker dùng bảng hiện có.
- Thêm biểu mẫu và API hạn mức toàn app/hồ sơ. API dùng lại lớp kiểm tra giao diện chủ app. Worker đặt ngữ cảnh ngân sách theo job cho mức Có giám sát và Toàn quyền. Các route LLM và TTS ưu tiên đường miễn phí ở ngưỡng cảnh báo. Khi đạt trần, lời gọi trả phí bị từ chối trước khi gửi, kể cả bước sửa JSON của LLM hoặc các đoạn TTS tiếp theo. Pipeline lên lịch lại lỗi chờ ngân sách mà không tăng lần thử hoặc ghi lỗi breaker. Cảnh báo được ghi một lần mỗi loại, phạm vi và kỳ ngân sách. Operator áp dụng hạn mức lượt toàn app, kể cả 0.
- Mã thêm và sửa trong `apps/server/src/api/autonomy.ts`, `apps/server/src/operator/autonomyBudget.ts`, `apps/server/src/operator/service.ts`, `apps/server/src/app.ts`, `apps/server/src/jobs/worker.ts`, `apps/server/src/pipeline/orchestrator.ts`, `apps/server/src/providers/llm/structured.ts`, `apps/server/src/providers/llm/types.ts`, `apps/server/src/providers/tts/registry.ts` và hai panel web. Không có migration mới trong lượt này.
- Typecheck, build web, 57 test server tập trung và 6 test web qua. Fixture xác nhận route LLM và TTS miễn phí vẫn chạy ở mức dừng, không gửi request tới nhà cung cấp trả phí, và hạn mức operator bằng 0 chặn nhận lượt mới. Chromium lưu hạn mức hồ sơ 2,5 USD và thấy đúng giá trị sau khi tải lại, dùng SQLite tạm.
- Giữ lượt render và đăng video trong cùng giao dịch nhận job, tính theo ngày giờ Việt Nam. Trần render toàn app và từng hồ sơ cùng áp dụng. Trần đăng tính riêng tài khoản, với mức dự trù mặc định sáu lượt YouTube cho hồ sơ tự chủ khi chưa cấu hình trần. Lần thử lại cũng chiếm một lượt. Job vượt trần nằm trong hàng đợi và worker vẫn có thể chọn job khác. `get_autonomy_status` trả thêm số lượt đã nhận. Ledger bắt đầu tính từ khi cài migration.
- Thay đổi ở `apps/server/src/operator/autonomyJobLimits.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/jobs/jobRepository.ts`, `apps/server/src/jobs/worker.ts`, `apps/server/src/pipeline/orchestrator.ts`, `apps/server/src/assistant/tools.ts` và hướng dẫn. Drizzle sinh `apps/server/drizzle/0051_naive_unus.sql`, snapshot và journal. Lượt generate thứ hai báo `No schema changes`.
- Worker bỏ qua tìm ảnh web bổ sung bằng Brave và Gemini khi ngân sách vào mức cảnh báo hoặc dừng. Nguồn ảnh thường tiếp tục chạy. Mã trong `apps/server/src/services/visualService.ts`.
- Typecheck qua. Bộ registry/publishing/worker/pipeline có 45 test qua, bộ tìm ảnh có 12 test qua và bộ web có 6 test qua. Test dùng job tạm, publisher giả và Brave giả lập.

## Phần 3 · Heartbeat và phát hiện sự cố

- Supervisor chạy khi worker bật, kiểm tra mỗi hai phút và lưu heartbeat trong bảy ngày. Dùng đồng hồ có thể tiêm để kiểm tra timeout, job chờ quota, cooldown, kết nối tài khoản, thiếu chủ đề, lịch đăng chưa có bản render, dung lượng và worker chưa nhận job. Cảnh báo được gộp theo sự cố và đóng khi điều kiện biến mất. Cảnh báo quota giữ nguyên luồng sự kiện hiện có.
- Worker tự đánh thức một lần khi còn chỗ nhưng bỏ sót job sẵn sàng trong mười phút. Nếu kiểm tra tiếp theo vẫn thấy vấn đề, app nâng mức sự cố. Job render của hồ sơ tự chủ chờ khi dung lượng thấp. Supervisor chưa xóa file.
- Ghi sự cố khởi động lại trước khi worker thực hiện luồng khôi phục job sẵn có. Job và hồ sơ thử dùng SQLite tạm. Không dùng model trong lượt kiểm tra.
- Thay đổi ở `apps/server/src/operator/supervisor.ts`, `apps/server/src/app.ts`, `apps/server/src/jobs/worker.ts`, `apps/server/src/pipeline/orchestrator.ts`, `apps/server/src/api/autonomy.ts`, `apps/server/src/db/schema.ts`, panel `SupervisorStatusPanel.tsx`, test registry/web và hướng dẫn. Drizzle sinh `0052_glorious_bishop.sql` và snapshot. Lượt generate thứ hai báo không đổi schema.
- Không xem thời hạn access token YouTube thông thường là lỗi kết nối vì token này được làm mới định kỳ. Tài khoản YouTube ở trạng thái lỗi hoặc hết hạn vẫn có cảnh báo và ghi chú về chế độ Testing.
- Typecheck, build web, bộ 44 test server và 6 test web tập trung đều qua. Lượt registry cuối có 16 test qua. Đồng hồ giả kiểm tra giữ heartbeat, khóa render khi thiếu đĩa, nudge một lần, phát hiện tài khoản và ngân sách, cùng giờ đăng địa phương qua DST. Chromium mở được panel qua API thật trên hồ sơ và SQLite tạm.
- Khôi phục lịch operator dựa trên heartbeat trước khi server dừng. Mỗi cron chỉ xét lần gần nhất trong sáu giờ và ghi mốc trước khi xếp hàng để tránh chạy trùng. Mốc cắt của khoảng bị bỏ qua và số lượt nhận/từ chối nằm trong finding `restarted`. Cơ chế ưu tiên tránh phát lại nếu tiến trình chết giữa khi lưu mốc và khi nhận lượt.
- Lịch đăng tự động liên kết với chủ đề, bị lỡ từ hai giờ trong thời gian server tắt, được chuyển sang khung trống nếu có quyền chiến lược. Nếu thiếu quyền, đang pause hoặc không có khung, lượt đăng chuyển sang trạng thái cần xem lại. Lượt trễ dưới hai giờ đi qua ticker thường. Khôi phục giữ luồng riêng của lịch thủ công và lịch chờ quota. Ticker chuyển trạng thái và tạo job trong một giao dịch, tái dùng job sẵn có và bỏ qua bài đã có dấu đăng. Executor vẫn giữ trạng thái chưa rõ kết quả sau khi tải lên bị gián đoạn để tránh phát lại tự động.
- Các thay đổi khôi phục nằm ở `apps/server/src/operator/cron.ts`, `apps/server/src/operator/service.ts`, `apps/server/src/operator/supervisor.ts`, `apps/server/src/app.ts`, `apps/server/src/publishing/recoverSchedule.ts`, `apps/server/src/publishing/publishService.ts`, `apps/server/src/stages/publish/publishExecutor.ts` và panel/hướng dẫn. Không đổi schema.

## Phần 4–16 · Đã nối thêm

- Mục tiêu, góp ý, yêu cầu Cần bạn, chia quota luân phiên, canary định tuyến, dừng toàn app, mã nâng quyền, drain và nhật ký hoàn tác nằm ở `apps/server/src/operator/autopilot.ts` cùng API trong `apps/server/src/api/autonomy.ts`.
- Bảng mới và cột audit do Drizzle sinh trong `apps/server/drizzle/0053_workable_photon.sql`. Lượt generate thứ hai báo không đổi schema.
- OmniRoute v3.8.53 được đối chiếu tại `https://raw.githubusercontent.com/cheaper-inference/OmniRoute/v3.8.53/docs/openapi.yaml`. Tool mới dùng `GET /api/db-backups/export` và `GET /api/v1/models`. Hàm combo cũ vẫn `POST /api/db-backups/export`. Không có tool tạo kết nối mới.
- Cổng chất lượng chỉ chạy khi lời gọi có `autopilot: true`. Bình luận và xu hướng không sinh tool (`toolsFromUntrustedText`).
- Giao diện: mục tiêu trên tab hồ sơ, danh sách Cần bạn, nút Dừng tự vận hành, trang Nhật ký tự vận hành. Hướng dẫn `docs/user-guide/tu-van-hanh.md` có mục Windows Task Scheduler.
- Hai task LLM mới: `operatorPlan`, `operatorClassify`. Trần catalog trợ lý trong test nâng lên 22.000 vì thêm tool.

## Phần 2, 3, 9 và 10 · Vòng chốt

- Phí ảnh Brave tự ghi vào `cost_entries` (nguồn `auto`, loại `image`, 0,005 USD mỗi request) và được cộng vào hạn mức cùng chi phí nhập tay. Lời gọi LLM ngoài worker cũng đọc hạn mức khi hồ sơ đang ở Có giám sát hoặc Toàn quyền và đã đặt trần chi. Lượt operator theo hồ sơ dùng `maxOperatorRunsPerDay` của hồ sơ nếu có. Ở ngưỡng 80% hoặc 100%, chuỗi model giữ những model đạt điểm tối thiểu trên `model_task_stats` rồi xếp theo chi phí. Mỗi lời gọi trả phí giữ 0,01 USD cho đến khi xong để các lời gọi chồng nhau không cùng vượt trần.
- Playbook chạy trong supervisor trước khi gọi model: thiếu chủ đề thì gọi gợi ý chủ đề khi có quyền `topics`; slot sắp đến hạn thì dời 24 giờ khi có quyền `strategy`; OmniRoute lỗi thì bật `autonomy.gatewayBypass` để đi provider trực tiếp và tắt lại khi gateway khỏe; job chờ quota được đánh dấu đang xử lý, ưu tiên model miễn phí trong chuỗi. Dọn `tmp`/`cache` khi đĩa thấp giữ như trước.
- 05:00 giờ Việt Nam áp mục tiêu vào lịch hồ sơ. 06:00 thứ Hai ghi đối chiếu tuần vào `spec.plan.weekly` và dời giờ đăng thêm 30 phút nếu đang chậm và có quyền chiến lược. 21:00 gửi bản tin; một câu model (`DigestLine`) chỉ chạy khi hạn mức chưa đầy.
- Hoàn tác đọc JSON `undo`: khôi phục cấu hình, đảo chủ đề, chuyển bài đăng sang `CANCELLED` / riêng tư / `withdrawn` và gọi `setPrivate` khi có id nền tảng, gỡ trả lời hoặc hiện lại bình luận, mở lại cổng nếu bước sau chưa chạy. Nút trên nhật ký chỉ hiện khi có `undo`.

## Kiểm tra vòng này

- `npm run typecheck` qua.
- `npx drizzle-kit generate` trong `apps/server` in `No schema changes, nothing to migrate`. Không có migration mới.
- Shared 354, MCP 19, web 176 qua. Server 760 qua và 1 bỏ qua trong lượt đầy đủ; `connections.test.ts` hết giờ hook và một test TikTok hết 10 giây khi chạy cả workspace. Chạy lại hai file đó với timeout 30 giây thì 36 test qua.
- Live check trên server tạm `127.0.0.1:3199`, `DATA_DIR` là thư mục tạm, mock LLM, không đụng dữ liệu thật hay dự án bảo vệ. Đã làm: đặt hồ sơ Toàn quyền (`computerUse` vẫn tắt), lưu mục tiêu 20:00, gọi kế hoạch ngày (1 video, giờ 20:00), lưu góp ý và thấy khối giọng đọc, bấm dừng thì mức về Trợ giúp. Chưa chạy pipeline, breaker ba lần lỗi, `needs_key`, hay khởi động lại giữa job. Không gọi ghi OmniRoute thật.

## Chưa làm trên môi trường thật

- Không gọi API nền tảng để đặt video riêng tư hoặc xóa bình luận đã đăng. Hoàn tác bài đăng và bình luận cập nhật SQLite và chỉ gọi hook `setPrivate` khi có id ngoài.
- Live check còn thiếu bước pipeline, breaker, `needs_key` và khởi động lại giữa job. Các bước đó có test riêng, không chạy trên server tạm.
