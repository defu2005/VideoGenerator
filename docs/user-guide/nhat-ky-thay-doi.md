# Nhật ký thay đổi {#nhat-ky}

## TASK-148d

- **Gợi ý truy vấn ảnh theo kênh:** agent tìm ảnh nhận các truy vấn đã đạt cho cùng chủ đề và cùng kênh (profile) của dự án. Kênh khác không thấy gợi ý của nhau. Công cụ `visual_cache_query` chỉ gợi ý cho dự án không gắn kênh.
- **Migration 0096:** bảng gợi ý ảnh có thêm cột kênh; dữ liệu cũ được gán kênh trống.

## TASK-129a

- **Kênh hai chiều cho agent:** agent đăng ký nhận sự kiện theo loại và dự án, qua webhook ký số, hoặc kéo qua SSE và bộ hỏi 15 giây.
- **Hộp thư agent:** agent gửi, đọc, xác nhận và xem chuỗi tin; câu hỏi chưa trả lời được chuyển cho agent trực sau 15 phút và cho bạn sau 60 phút. Giới hạn 60 tin mỗi phút cho mỗi agent.
- **Trang Đội agent:** bạn xem các chuỗi tin và gửi tin vào chuỗi; tin của bạn được coi là chỉ đạo cấp cao nhất.

## TASK-129c

- **Mission (giao việc một lệnh):** tạo mission từ một lệnh, xem kế hoạch và checkpoint, gỡ chờ người hoặc huỷ mission. Có trên trang Mission, lệnh `/mission` trên Telegram và công cụ trò chuyện (ghi hành động cần bạn xác nhận). Xem [Giao việc một lệnh (Mission)](tu-van-hanh.md#mission).
- **Mất nhịp trực:** nếu không có agent trực quá 5 phút, bạn nhận một thông báo cho mỗi lần mất nhịp; agent dự phòng nhận trực ở nhịp đầu tiên, mission đang mở vẫn chạy.
- **Bản tin:** bản tin 21:00 có thêm dòng Mission (đang chạy, chờ bạn, video đã đăng hôm nay, kết thúc và lỗi). Bản tin sáng lúc 07:00 báo ngày hôm qua, cùng dòng Mission.
- **Xác nhận rủi ro giữ mission:** khi một thao tác cần xác nhận có gắn dự án được tạo, mission đang chạy của dự án đó chuyển sang chờ bạn. Xác nhận hoặc từ chối sẽ trả mission về đang chạy, trừ khi dự án còn cổng chờ bạn. Thao tác hết hạn không tự trả mission; bạn gỡ chờ tay.
- **Chưa có:** nâng mức tự vận hành từng mission trên trang web.

## TASK-148

- **Mẫu truy vấn ảnh:** ghi nhận truy vấn đạt hoặc không đạt theo chủ đề, và gợi ý cho công cụ tra cache ảnh. Xem [Mẫu truy vấn ảnh](phan-tich-va-tai-chinh.md#mau-truy-van-anh).
- **Phong cách viết đã duyệt:** đăng ký và duyệt phong cách viết cho bước Kịch bản (chỉ người dùng duyệt). Xem [Phong cách viết đã duyệt](phan-tich-va-tai-chinh.md#phong-cach-viet).
- **Công cụ đọc:** `get_stage_lessons` và `stage_quality_report` cho MCP.

- **Bài học theo bước:** ghi chú cho từng bước pipeline được đề xuất hằng tuần từ phản hồi (sửa kịch bản, sửa lời dẫn, duyệt có chỉnh sửa) và chỉ dùng sau khi bạn duyệt. Nghiên cứu và kịch bản đọc bài học đã duyệt. Xem [Bài học theo bước](phan-tich-va-tai-chinh.md#bai-hoc-theo-buoc).
- **Chất lượng theo bước:** sổ ghi chất lượng mỗi lần chạy bước, xu hướng 14 ngày trên trang Phân tích, và cảnh báo khi điểm giảm trên 20%. Xem [Chất lượng theo bước](phan-tich-va-tai-chinh.md#chat-luong-theo-buoc).
- **Công cụ trợ lý và vận hành:** `list_stage_feedback`, `stage_quality_report` (chỉ đọc), `propose_stage_note` (đề xuất), `decide_stage_note` (cần xác nhận của bạn).

## TASK-139

- **Xem trước theo đúng kế hoạch hiện tại:** kế hoạch dựng đã lưu chỉ được tái dùng khi mọi đầu vào vẫn khớp (ảnh, chuyển động, FPS, chữ graphic, thứ tự và số cảnh, nội dung và giọng đọc, cài đặt dựng). Nếu timeline hoặc cài đặt đã đổi, xem trước dựng lại kế hoạch tạm và ghi chú lý do. Thiết lập chạy như mốc kiến thức không làm dựng lại. Chưa tối ưu tốc độ dựng lại tạm (chưa đạt mục tiêu 3 giây).

## TASK-141

- **Định hướng hình ảnh và nhịp (Director continuity pass):** sau bước phân cảnh, sinh kế hoạch định hướng thống nhất cho toàn bộ video gồm bảng màu (Lab/hex kế thừa phong cách kênh), nhân vật xuyên suốt (kèm query tham chiếu), nhịp cắt mục tiêu theo từng phần và mô-típ lặp lại.
- **Tích hợp tìm kiếm và chọn ảnh:** bổ sung query tham chiếu cho cảnh có nhân vật/mô-típ nhưng giữ nguyên câu tìm gốc ở đầu; tính điểm thưởng liên tục (bảng màu và nhịp) mà không vượt qua cổng liên quan hay lựa chọn thủ công của người dùng.
- **Thẻ Định hướng và Bảng kiểm tra liên tục:** hiển thị thẻ "Định hướng hình ảnh" trên tab Cảnh và bảng phát hiện lệch màu/lệch nhịp/mô-típ/nhất quán nhân vật trên tab Ảnh kèm nút tìm lại từng cảnh. Xem [Định hướng hình ảnh và nhịp](hinh-anh-va-giong-doc.md#dinh-huong-hinh-anh).
- **Công cụ trợ lý:** bổ sung hai công cụ chỉ đọc `get_continuity_plan` và `check_continuity`.
- **Sửa theo liền mạch (TASK-141 P2):** lệch màu giữa hai cảnh đổi ứng viên ở cảnh sau; thiếu mô-típ tìm lại cảnh rồi mới chọn. Mỗi bậc chỉ thử một lần trong một cửa sổ; cặp lệch màu thứ hai trong cùng cửa sổ không được thử lại. Cảnh đã tự chọn (owned) không bị đụng. Nhịp và nhân vật không tự sửa.

## TASK-145

- **Story Engine sản xuất kịch bản đa bước:** phân rã bước SCRIPT thành chuỗi khép kín: dàn ý & khung tự sự, 3 ứng viên câu mở đầu (hook), viết lời dẫn bám nhịp, giám khảo chấm điểm theo 6 tiêu chí (thang 100 điểm), tự sửa nhắm mục tiêu cho các đoạn chưa đạt, và tự động co giãn vừa vặn thời lượng.
- **Bảng Dàn ý & Đánh giá trên Web:** hiển thị khung cốt truyện, các nhịp kể (nhấn để cuộn nhanh), so sánh điểm 3 câu mở đầu, nút đổi hook kèm tự viết lại phần 1, và nút chấm lại điểm khi sửa tay. [Kịch bản: dàn ý, hook và chấm điểm](du-an-va-quy-trinh.md#dan-y-hook-cham-diem)
- **Công cụ MCP & Trợ lý:** bổ sung `get_script_draft`, `switch_script_hook`, `rescore_script` cho các agent vận hành và trợ lý trò chuyện.

## TASK-143

- **Độ bền bỉ máy chủ điều khiển (Control Plane Resilience):** bọc CSDL SQLite đo độ trễ câu lệnh p50/p95/tối đa, bắt khóa bận `SQLITE_BUSY` tự động thử lại kèm backoff, hiển thị thẻ "Cơ sở dữ liệu" trong Cài đặt → Render (`GET /api/admin/db-stats`).
- **Gộp ghi đĩa (Hot-write Coalescing):** lọc các tín hiệu sống (heartbeat) trùng lặp từ máy worker trong vòng 15 giây, gộp ghi nhật ký audit log và mức dùng LLM relay theo chu kỳ 1 giây, tự động xả sạch khi tắt server.
- **Thu gọn WAL & Diễn tập khôi phục:** tự động `wal_checkpoint(TRUNCATE)` khi WAL vượt quá 16 MB; bổ sung script `deploy/docker/restore-drill.sh` kiểm chứng khôi phục CSDL và sổ tay vận hành `docs/RUNBOOK-two-machines.md`.

## TASK-147a

- **Khung adapter nhận stage cho agent ngoài:** chuẩn hóa kiến trúc `StageAgentAdapter` cho các bước pipeline (`VISUAL_SEARCH`, `RESEARCH`, `SCRIPT`, `MUSIC_SEARCH`).
- **Phân công và nhận việc theo vai trò:** `stage_claim_next` đối chiếu vai trò phân công của agent với yêu cầu của adapter (loại trừ vai trò quản lý kênh `channel_manager`).
- **Cấu hình người xử lý:** hỗ trợ chọn app, agent ngoài hoặc app làm trước cho các bước được mở rộng; mặc định các bước mới vẫn do app xử lý, riêng tìm ảnh giữ `app_then_agent`. Xem [Agent nhận stage](agent-nhan-stage.md).

## TASK-147b

- **Agent nghiên cứu có nguồn:** `research_submit_notes` nhận notes có nguồn (url, tiêu đề, trích dẫn tối đa 30 từ) cho stage RESEARCH; app kiểm đủ 6 fact, tối thiểu 60% có nguồn, miền bị chặn và URL nội bộ; panel nghiên cứu hiện nguồn và trích dẫn cho từng fact.

## TASK-147d

- **Agent viết kịch bản:** `script_submit_draft` nhận kịch bản theo cấu trúc app yêu cầu cho stage SCRIPT. App chạy lint nhịp văn, critic và kiểm sự thật trước khi ghi; bản dưới ngưỡng bị giữ kèm critique, agent được nộp lại tối đa 2 lần trong lease, lần thứ ba trả việc về app. Bản đạt được ghi với `author` là `agent:<instance>`.
- **Chưa có:** `script_submit_outline` (TASK-146) chưa được triển khai, nên agent chưa nộp dàn ý.

## TASK-147c

- **Agent tìm nhạc có giấy phép:** `music_submit_candidates` nhận tối đa 8 ứng viên; app kiểm giấy phép thương mại, URL công khai, trùng lặp, tải tệp và lưu; ứng viên đi vào MUSIC_REVIEW. Agent không chọn bản cuối cùng. Nhạc ngắn hơn video được lặp theo timeline.

## 2026-11-17 — Bản vận hành và bản phát triển

- **Hai bản app:** bản vận hành (product) chạy dữ liệu thật ở `http://localhost:5100`, bản phát triển (dev) chạy dữ liệu thử `data-dev`. Tính năng mới lên bản vận hành sau review, có sao lưu trước khi nâng cấp. [Bản vận hành và bản phát triển](cai-dat.md#ban-van-hanh)
- **Cần làm khi chuyển:** dừng mọi `npm run dev` cũ đang chạy trên dữ liệu thật trước khi chạy bản vận hành. Khi nối thêm tài khoản nền tảng ở bản vận hành, thêm callback cổng 3100 vào ứng dụng của nền tảng.

## TASK-144

- **Kịch bản kể chuyện hơn.** Người viết, bản gộp và bước đọc lại đều nhận đủ hướng dẫn của mẫu video (mục đích từng phần, kiểu mở đầu, mức đọc) và bộ quy tắc kể chuyện chung. Bộ kiểm tra bằng mã báo lỗi liệt kê năm, lời sáo, lời kết rập khuôn; kết quả hiện ở ghi chú `[lint]`. [Bộ kiểm tra kịch bản](du-an-va-quy-trinh.md#kiem-tra-kich-ban)

## TASK-138

- **Dọn tệp theo thời gian giữ.** Trang Lưu trữ có thống kê, bản chạy thử, xác nhận dọn và cài đặt thời gian giữ. Xóa project và giữ số bản render đi qua quy trình đánh dấu. Dashboard cảnh báo khi ổ đĩa gần đầy. [Vòng đời tệp](render-va-thumbnail.md#luu-tru)

## TASK-137

- **Lưu trữ S3 cho worker.** Worker có thể tải đầu vào và gửi kết quả qua kho tương thích S3. Cài đặt có nút thử kết nối, thống kê và trạng thái chuyển đường truyền về máy chủ. [Lưu trữ](render-va-thumbnail.md#luu-tru)

## TASK-136

- **Sửa sau review:** giới hạn và usage tách theo workspace; giữ ngân sách cho các lượt gọi đồng thời, ghi chi phí cả khi phản hồi lỗi và đưa lời gọi không gắn job vào báo cáo sử dụng/tài chính. Số ước tính và giá chưa rõ được ghi rõ trên giao diện.
- **LLM qua máy chủ:** máy Hermes, scout, operator và máy worker gọi mô hình qua máy điều khiển; chỉ máy điều khiển giữ khoá OmniRoute. Có giới hạn model, tốc độ và ngân sách ngày cho từng máy, và thống kê dùng hôm nay. [LLM qua máy chủ](mo-hinh-ai.md#relay-llm)
- **Cần làm khi nâng cấp:** xoá `VG_HERMES_MODEL_KEY` khỏi `hermes.env` trên các máy Hermes (không còn dùng) rồi đồng bộ lại để nhận gói mới. Khoá `llm:*` không còn được cho node mượn; cài đặt cũ còn liệt kê chúng sẽ bị bỏ qua và ghi một dòng nhật ký.

## TASK-139

- **Xem trước nhanh:** tab Timeline có nút xem 3 khung của từng cảnh, phát đoạn 3 giây và contact sheet cả video mà không cần render. Kèm ghi chú tính bằng mã (chữ sát mép, quá tối/sáng, cảnh trùng). Không tự chạy, không đổi trạng thái bước. [Xem trước nhanh](render-va-thumbnail.md#xem-truoc-nhanh)

## TASK-099

- **Sơ đồ và dòng thời gian:** Compose có thêm sơ đồ tối đa 7 nút cho thể loại Giải thích/Hướng dẫn và dòng thời gian tối đa 8 mốc cho Lịch sử/Tổng hợp tin. Nội dung lấy từ lời dẫn, thời điểm hiện theo giọng đọc, bố cục tự đổi ngang/dọc và dùng phong cách kênh.
- BALANCED chỉ trích sơ đồ khi cần; QUALITY/MAX có thể tinh chỉnh cả hai bằng lời gọi dựng đã được định tuyến và tính chi phí. ECO không gọi AI cho sơ đồ. Dữ liệu không hợp lệ lùi về danh sách hoặc hình minh họa.
- Tab Render hiện tên hai kiểu cảnh mới và vẫn cho khoá/bỏ khoá. Xem [Sơ đồ và dòng thời gian](so-do-va-dong-thoi-gian.md).

## TASK-135a

- Mã tham gia mới giới hạn máy worker vào workspace đã tạo mã, áp dụng cả khi giao từng bước. Máy cũ giữ phạm vi toàn instance đến khi được thu hồi và tham gia lại. [Phạm vi workspace](may-worker.md#workspace)
- Bổ sung nền tảng truyền dữ liệu và checkpoint cho node chạy cả dây chuyền. Lựa chọn nơi chạy và màn hình theo dõi sẽ có ở các phần tiếp theo của TASK-135.

## TASK-134

- Quy trình phát hiện đầu vào đổi khi một bước đang chạy, báo cần chạy lại và chặn đăng bản dựng đã lỗi thời. [Đầu vào đổi khi bước đang chạy](du-an-va-quy-trinh.md#dau-vao-da-doi)
- Worker tiếp tục gửi từ byte đã lưu, bỏ qua tệp đúng mã băm đã có và cho máy chính hoàn tất từ tệp đã nhận sau khi khởi động lại. [Tải tiếp kết quả](may-worker.md#tai-tiep-ket-qua)

## TASK-128b

- **Sửa sau review:** đổi lời dẫn, tỉ lệ khung hoặc quy tắc kiểm ảnh sẽ kiểm tra lại độ phù hợp; cache theo chủ thể chỉ để tham khảo nếu ngữ cảnh khác. Ảnh do người dùng giữ tiếp tục được giữ nguyên.
- **Phân công agent** trong Cài đặt → Đội Hermes. Chọn phạm vi video, hồ sơ hoặc bước và giới hạn số job cho từng instance. Fleet theo dõi hàng đợi và gợi ý bổ sung scout khi chờ lâu.
- **Skill theo vai trò và cache ảnh**. Scout ưu tiên quy trình tìm ảnh trong gói đồng bộ. App và scout chia sẻ kết quả tìm, verdict cùng chủ thể và ghi chú nguồn trong workspace. Xem [Agent nhận stage](agent-nhan-stage.md#them-scout).

## TASK-128a

- **Agent nhận bước tìm ảnh:** chọn app, agent ngoài, hoặc app trước rồi chuyển các cảnh còn mở cho agent. Cấu hình dự án ưu tiên hơn hồ sơ; có thể bỏ override để tiếp tục kế thừa. Thời gian chờ mặc định 30 phút.
- **Nhận việc có lease:** khóa máy gắn danh tính cố định; một chủ cho mỗi job, heartbeat, kiểm tra lại lease khi ghi và kiểm tra thật trước khi hoàn tất. Người dùng sửa dự án hoặc bấm **Lấy lại cho app** sẽ ngắt lease cũ. Vòng sửa ảnh hết cách có thể chuyển cho agent trước khi hỏi hoặc gác dự án.
- **Ảnh agent tìm và duyệt:** tải URL an toàn, lưu nguồn/hash, loại trùng, xem đúng tệp qua MCP và gắn kết quả vision với hash. Giữ nguyên các cổng bản quyền, nguồn, watermark và chất lượng; chỉ người dùng đổi chế độ bản quyền.
- **Theo dõi:** hiển thị chủ việc, lý do, heartbeat, ai tìm/duyệt ảnh và model; cảnh báo nhận–trả quá ba lần. Chi phí agent chưa báo được ghi là chưa rõ, tách khỏi các lời gọi provider của app. Xem [Agent nhận stage](agent-nhan-stage.md).



Mục mới ở trên. Mỗi task làm đổi việc bạn thấy hoặc việc bạn bấm sẽ thêm một mục.

## TASK-122

- **Hermes giám sát Operator: một chuỗi chỉ huy, không xung đột:**
  - **Phân định vai trò:** Operator chạy ngầm trong tiến trình app để thực hiện tác vụ hàng ngày; Hermes chạy bên ngoài (WSL, container) đóng vai trò giám sát viên (Supervisor) trực nhật 24/7, theo dõi operator, xử lý việc chuyển giao (escalation), phát hiện bất thường và có thể tiếp quản tài nguyên khi cần. Chuỗi chỉ huy: Người dùng > Hermes trực nhật > Operator > Mã giám sát deterministic.
  - **Khóa tài nguyên (Leases):** Mỗi tài nguyên (dự án, tự động hóa hồ sơ, lượt đăng...) tại một thời điểm chỉ có một agent giữ quyền thay đổi. Thứ tự ưu tiên cho phép cấp trên tiếp quản (preempt) cấp dưới: Người dùng (rank 40) > Hermes trực nhật (rank 30) > Hermes khác (rank 20) > Operator (rank 10). Thao tác của người dùng luôn giải phóng khóa ngay lập tức.
  - **Trực nhật (Duty) & Chuyển giao việc (Escalation):** Chỉ một instance Hermes giữ quyền trực nhật (`hermes_duty_heartbeat`, TTL 3 phút). Các sự cố agent giải quyết được (cổng giữ, hết lượt sửa, job kẹt, nhà cung cấp lỗi, đăng bài thất bại, chỉ dẫn chưa rõ) tự động chuyển sang Hermes với hạn 30 phút thay vì làm phiền người dùng. Hết hạn hoặc mất trực sẽ tự chuyển tiếp tới người dùng ("Cần bạn"). Vòng lặp chuyển giao giới hạn tối đa 3 lần. Việc động chạm bí mật, tiền bạc, quyền hạn, xoá vĩnh viễn hoặc dự án bảo vệ luôn đi thẳng tới người dùng.
  - **An toàn dự phòng (Fail-safe):** Hermes tạm dừng operator tối đa 360 phút (6 giờ); nếu Hermes mất trực quá 10 phút, lệnh tạm dừng tự động được huỷ để operator tiếp tục. Lệnh dừng của người dùng (`/stop`) không bao giờ bị Hermes mở lại.
  - **Giao diện Web:** Tab "Hermes" mới trên trang Agent operator hiển thị thông tin trực nhật, danh sách instance, việc chuyển giao, khóa tài nguyên và nhật ký thao tác Hermes; cài đặt khóa cá nhân bổ sung chọn loại agent và bật quyền giám sát (`canSupervise`).
  - **Kỹ năng giám sát (Skill pack):** Kỹ năng `vg-supervise` (chu kỳ kiểm tra, tự im lặng khi yên bình) và `vg-escalation` (xử lý từng việc chuyển giao) định hình hành vi cho Hermes qua cron: `hermes cron create "every 15m" "Run the vg-supervise skill" --skill vg-supervise --name vg-supervise`. Xem [Tự vận hành](tu-van-hanh.md#hermes-giam-sat).

## TASK-131

- **Hoàn thiện các kết nối giữa TASK-120 và TASK-125:**
  - **Tải trước footage trước khi dựng (`media.prefetch`):** Khi kế hoạch compose đã sẵn sàng, hệ thống chủ động tạo việc phụ `MEDIA_FETCH` để tải trước các đoạn clip còn thiếu trong kho đệm (trên máy worker hoặc máy chủ) thay vì để bước dựng video phải tải từ đầu. Cài đặt `media.prefetch` (mặc định bật) cho phép tắt nếu cần. Xem [Máy worker](may-worker.md#kha-nang).
  - **Báo cáo hoạt động thực tế (`reportActivity`):** Các tiến trình con ffmpeg (`childAlive`, `childNote`) và các cuộc gọi mô hình ngôn ngữ (`llmInFlight`, `quotaWait`) được báo cáo liên tục theo nhịp điều tiết 5 giây vào ngữ cảnh thực thi, giúp cơ chế phát hiện bước quá giờ nhận diện chính xác bước còn đang chạy hay đã bị treo thật sự.
  - **Thời gian dự kiến còn lại (ETA):** Thẻ bước quá giờ và thanh tiến trình hiển thị ước tính \"dự kiến còn ~X phút\" khi bước đang chạy trong thời hạn dự kiến, và chuyển thành \"quá dự kiến X phút\" khi vượt quá. Xem [Bước chạy quá dự kiến](du-an-va-quy-trinh.md#buoc-qua-du-kien).
  - **Đồng nhất mã băm kế hoạch thời gian:** Gom logic băm kế hoạch timeout ở bảng tính ngân sách và server vào hàm chung `stageTimeoutHash`, đảm bảo kế hoạch tự động làm mới khi lịch sử thời gian các bước tích luỹ thêm.
  - **Sửa lỗi kiểm thử gác dự án:** Khắc phục triệt để lỗi kiểm thử `reopenShelved` quanh mốc nửa đêm giờ UTC bằng việc đồng bộ múi giờ và tiêm đồng hồ kiểm thử.

## TASK-130

- **Khử lặp thoại ở mép nối hook, outro và giữa các phần:** Lời dẫn không còn bị lặp lại ở điểm tiếp nối giữa câu hook và phần 1, giữa câu cuối của phần trước với câu đầu của phần sau, hoặc ở phần outro. Cơ chế lọc code thuần (`dedupeSeams`) chuẩn hóa NFC, so khớp tuyệt đối và tương đồng token Jaccard ≥ 0.9 (bảo vệ không làm rỗng phần dẫn) được áp dụng trực tiếp trong bước tạo kịch bản (`SCRIPT`) và lập kế hoạch cảnh (`planScenes`), đồng thời ghi log chi tiết từng câu bị loại bỏ. Prompt kịch bản bổ sung quy tắc hook và outro độc lập; hệ thống kiểm tra trước render cảnh báo nếu phát hiện hai cảnh liền kề bị trùng lặp câu (chỉ cảnh báo, không chặn render).

## TASK-133

- **Mã QR cho xác thực hai bước (TOTP 2FA):** trang **Tài khoản của tôi** nay hiển thị mã QR vẽ trực tiếp bằng SVG (chuẩn ECC Medium, vùng đệm 4 module, màu `currentColor` trên nền sáng giúp quét tốt cả ở chế độ tối) phía trên chuỗi khoá bí mật. Mã QR được tạo hoàn toàn cục bộ trên trình duyệt qua thư viện Project Nayuki (MIT, nhúng file đơn `apps/web/src/lib/vendor/qrcodegen.ts`, không thêm gói npm), không gửi URI hay bí mật ra bất kỳ máy chủ hay dịch vụ ngoài nào. Xem [Tài khoản của tôi](khong-gian-va-quyen.md#tai-khoan-cua-toi).
- **Kiểm tra phiên bản edge-tts:** hệ thống tự động kiểm tra phiên bản binary `edge-tts` (tối thiểu `7.3.1`, bộ nhớ đệm 10 phút) và hiển thị phiên bản cùng trạng thái tại trang **Cài đặt → Giọng đọc (TTS)** và chi tiết `/api/health`. Nếu phiên bản cài trên máy đã cũ và việc tạo giọng thất bại, lỗi được ánh xạ sang mã `TTS_BINARY_OUTDATED` (không thử lại vô ích) kèm câu thông báo tiếng Việt chứa lệnh chính xác `pip install -U edge-tts`. Cơ chế dự phòng giọng tự động coi mã này như chưa cấu hình để nhà cung cấp TTS khác trong chuỗi có thể tiếp quản. Xem [Giọng đọc](hinh-anh-va-giong-doc.md#giong-doc) và [Xử lý sự cố](xu-ly-su-co.md#loi-giong).

## TASK-113

- Độ giống hình ảnh đưa vào kiểm tra tính nguyên bản: sau khi render, app so độ giống hình ảnh (tổ hợp biến thể template, khung hình dHash, tỉ lệ cảnh quay và phong cách) với các video trước trong kênh và giữa các kênh trong không gian làm việc. Thẻ **Nguồn & tính nguyên bản** hiện dòng "Độ giống video trước" kèm điểm số, link video gần nhất, yếu tố chi phối (như cùng tổ hợp biến thể) và gợi ý đổi biến thể hoặc pack trong tab Phong cách. Ở mức cảnh báo (`warn`), cảnh báo chỉ hiển thị nhắc nhở; ở mức chặn (`block`), vượt ngưỡng chuyển dự án sang duyệt tay (`REVIEW`). Xem [Nguồn và tính nguyên bản](dang-bai.md#nguon-va-tinh-nguyen-ban).

## TASK-129b

- Bộ điều tiết tài nguyên máy (`resourceGovernor`): hệ thống đo CPU, RAM, ổ đĩa và GPU mỗi 5 giây, tự tăng hoặc giảm số việc chạy cùng lúc cho 4 nhóm việc (Dựng và xử lý CPU, GPU, Tải và đăng IO, Gọi AI) theo thuật toán AIMD để máy luôn chạy hết công suất mà không bị nghẽn (ngưỡng 85% CPU/RAM, 90% GPU, ổ đĩa trống trên 5 GB). Thẻ **Tài nguyên** trên Bảng điều khiển hiển thị tải và slot đang chạy; cài đặt bật/tắt và min/max từng nhóm ở **Cài đặt → Render** (`#tai-nguyen`); giám sát tự động cảnh báo khi việc chờ hơn 15 phút (`resource_starved`) và phát sự kiện `capacity_idle` khi máy rảnh rỗi hơn 10 phút. Xem [Tài nguyên máy](tai-nguyen-may.md).

## TASK-112

- Thể loại video giờ là dữ liệu: đạo diễn đọc gói thể loại (bỏ bản đồ, thẻ so sánh, danh sách mở đầu, ghi chú cho AI) thay vì kiểm tra tên công thức. Ở chế độ QUALITY, AI còn được chọn kiểu hiển thị cho từng khung đồ hoạ trong cùng một lần gọi, chọn sai thì tự dùng kiểu mặc định. ECO và BALANCED không đổi.

## TASK-127

- Khi nhà cung cấp AI hết quota hoặc bị giới hạn, hệ thống tự chuyển sang model dự phòng (đã bỏ qua model không đọc được ảnh, ECO không tự dùng model trả phí chưa liệt kê) và cho nhà cung cấp vừa lỗi nghỉ một lúc. Trang **Mô hình AI** hiện thẻ "đang nghỉ đến HH:MM", bảng giám sát cảnh báo nếu đổi nhà cung cấp liên tục. Xem [Tự chuyển nhà cung cấp](mo-hinh-ai.md#tu-chuyen).

## TASK-120

- Máy worker làm được thêm **tạo giọng đọc** và **tải clip stock**, giao theo khả năng từng máy (`render`, `tts:<nhà cung cấp>`, `media_fetch`). Mặc định vẫn chỉ dựng video chạy trên máy worker; bật từng bước ở thẻ **Các bước khác chạy trên máy worker**. Khoá TTS chỉ được cho mượn ngắn hạn theo từng việc, thu hồi khi xong, có thể giữ riêng từng khoá, và mỗi lần cho mượn được ghi ở thẻ **Khoá đã cho node mượn**. Xem [Khả năng của máy](may-worker.md#kha-nang) và [Khoá cho mượn](may-worker.md#khoa-cho-muon).

## TASK-126

- Bước **Tìm ảnh** ở chế độ MAX không còn bỏ qua việc AI nhìn: ảnh đã lưu mà chưa được nhìn sẽ được kiểm tra ở lần chạy lại, và ảnh tìm thêm trên web (Brave) cũng được AI nhìn trước khi chọn. Cảnh không có ảnh ghi rõ lý do, và dòng tóm tắt có thêm "vision checked X (web Y)". Xem [Không có ảnh nào được chọn](xu-ly-su-co.md#khong-co-anh). Sau bản này hãy chạy lại **Tìm ảnh** cho dự án đang thiếu ảnh.

## TASK-111

- Hồ sơ có tab **Phong cách**: tạo phong cách kênh từ mẫu, lựa chọn nhanh, màu thương hiệu hoặc AI gợi ý (ECO không gọi AI), chỉnh màu, phông, nhịp với cảnh báo chữ khó đọc, xem thử 3 khung và quay lại bản cũ. Chỉ áp dụng cho video render sau. Xem [Phong cách](ho-so.md#phong-cach).

## TASK-119

- Có trang **Máy worker** riêng: thêm máy bằng hộp thoại có đếm ngược mã, xem sức khoẻ và kết quả dựng thử thật, rút việc, thu hồi, và nút **Cập nhật tất cả** cho máy lỗi thời. Bước Dựng video ghi rõ máy nào đã dựng. Xem [Máy worker](may-worker.md).

## TASK-125

- Hết thời gian dự kiến, bước không còn bị dừng ngay: hệ thống kiểm tra xem còn làm việc không, rồi chờ thêm hoặc hỏi bạn (nút Chờ thêm, Dừng và thử lại, Dừng hẳn). Xem [Bước chạy quá dự kiến](du-an-va-quy-trinh.md#buoc-qua-du-kien).

## BUGFIX-TEAM-REPORTS

- Báo cáo tháng của mỗi không gian làm việc nay tách riêng, không ghi đè hay lộ cho nhau. Quản trị chỉ thu hồi được khóa của chính mình; khóa dịch vụ trên máy chỉ chủ sở hữu thu hồi được. Xem [Không gian và quyền](khong-gian-va-quyen.md).

## TASK-118

- Có thể dựng video trên máy worker khác (thử nghiệm, mặc định tắt). Tạo mã tham gia ở Cài đặt → Render → **Máy worker (thử nghiệm)**. Xem [Máy worker](may-worker.md).

## TASK-124

- Mọi agent dùng chung một bộ kỹ năng vận hành (`video-van-hanh-app` và 10 kỹ năng việc cụ thể). Agent có thể đề xuất kỹ năng mới dưới dạng bản nháp để bạn duyệt, và lệnh `npm run export-skills` đưa kỹ năng đã duyệt vào repo. Xem [Tự vận hành](tu-van-hanh.md#ky-nang-dung-chung).

## TASK-115

- Có nhiều không gian làm việc với sáu vai trò và quyền theo kênh; dữ liệu mỗi không gian tách riêng, thao tác ghi có nhật ký. Xem [Không gian làm việc và quyền](khong-gian-va-quyen.md).

## TASK-121

- Video không đạt cổng chất lượng (kịch bản, ảnh cảnh, render) được agent tự sửa trong giới hạn bạn đặt; hết lượt thì video bị gác (**Shelved**) và có dòng trong bản tin. Trang dự án có khối **Tự sửa chất lượng** với nút **Mở lại**; bảng điều khiển hiện "Đang tự sửa (lần N/M)". Xem [Tự vận hành](tu-van-hanh.md#tu-sua-chat-luong).

## TASK-114

- Lần đầu mở app, hãy tạo chủ sở hữu rồi đăng nhập. Menu trái hiện tên bạn và nút **Đăng xuất**.
- Mọi trang API yêu cầu phiên đăng nhập hoặc khoá của máy này. Xem [Đăng nhập và tài khoản](dang-nhap.md).
- Quên mật khẩu: chạy `npm run reset-password` ở thư mục dự án trên máy chạy server. Xem [Quên mật khẩu](dang-nhap.md#quen-mat-khau).

## BUGFIX-VISION-SCHEMA

- Tìm ảnh (MAX): nếu AI nhìn ảnh trả về sai định dạng, bước không còn dừng cả stage; ảnh đó được bỏ qua và tóm tắt stage báo số ảnh cần bạn xem.

## TASK-110

- Mẫu so sánh, câu trích, chữ động, biểu đồ và bản đồ dùng chung bộ phong cách của hồ sơ: màu, chữ, chuyển động và cách xếp.

## TASK-117

- Có thể chạy app bằng Docker trên một máy Linux: một image, Caddy phía trước, script `deploy/install.sh`. Xem mục Docker trong Cài đặt.
- Máy worker chưa nhận việc. Image không chứa đăng nhập CLI hay OmniRoute.

## TASK-109

- Mỗi hồ sơ giữ một bộ phong cách. Video render xong được ghi diện mạo, để video sau của cùng kênh đổi cách xếp khi còn cách khác.

## TASK-108

- Đoạn danh sách toàn màn dựng được. Trước đó thiếu phong cách nên bước đồ hoạ lỗi.
- Màu lấy từ màu thương hiệu của dự án khi có, và từ dạng video. Cùng một video thì cách xếp danh sách không đổi. Đổi màu thì đoạn đó dựng lại.

## TASK-107

- Timeline và render không dừng khi lần kiểm tra nguyên bản bị lỗi. App ghi một cảnh báo rồi tiếp tục.
- Đồ họa toàn màn hình trên timeline là lớp trong suốt, nên thời gian ảnh bên dưới vẫn tính vào giấy phép chưa rõ.

## TASK-076

- Khi ảnh đang chờ bạn duyệt, giọng, phụ đề và nhạc vẫn chạy. Timeline chỉ ghép khi cả hai làn xong.
- **Hủy làn** dừng một làn. **Cancel** dừng cả dự án.
- `RENDER_CONCURRENCY` (mặc định 1) giới hạn số video xuất cùng lúc. Các bước nhẹ của dự án khác vẫn chạy bên cạnh. Health hiện `render: x/y đang chạy`.

## TASK-070b · Sửa cảnh quay

- Tab **Render**, mục **Cảnh quay**, mỗi đoạn có **Đổi kiểu**, **Đổi footage** và **Khoá**. Đoạn khoá được giữ khi dựng lại.
- Bản đồ, so sánh, câu trích và danh sách được chọn khi lời thoại khớp: tên nước hoặc tỉnh, hai vế so sánh, câu trong ngoặc kép có người nói, danh sách 3 đến 6 mục.
- Chế độ đạo diễn **chất lượng** gọi AI một lần cho cả video. **ECO** không gọi.

## TASK-084 · Nguồn và tính nguyên bản

- Tab **Render**, mục **Đăng**, có thẻ nguồn: phần tự làm, video giống nhất, giấy phép và link.
- Cảnh báo còn mở thì đăng công khai tự chuyển riêng tư cho đến khi bạn sửa hoặc ghi lý do bỏ qua.
- **Định hướng nội dung** có ngưỡng an toàn theo hồ sơ. Đây là ngưỡng của app, kèm checklist nhắc chính sách từng nền tảng.

## TASK-070 · Nhiều cảnh quay là mặc định

- Dự án chưa chọn kiểu dựng sẽ dựng nhiều cảnh quay. Trong form **Kiểu dựng**, chọn **Cổ điển (ảnh tĩnh)** để về cách cũ.
- Bản đồ, so sánh, câu trích và danh sách đi cùng chữ động và biểu đồ. ECO tắt cả nhóm này.

## BUGFIX-VISUAL · Ảnh nguồn và cổng chọn ảnh

- Ảnh lưu trong dự án được đọc đúng thư mục. Ảnh thiếu file báo lỗi thay vì gửi ảnh trắng cho AI nhìn.
- Ảnh nhỏ hơn 64 px hoặc nhẹ hơn 2 KB không được gửi cho AI nhìn.
- Ở chế độ MAX, cảnh do agent chọn mà chưa có kết quả AI nhìn ở trạng thái **Cần bạn**.
- Ảnh bạn đã khoá không bị thay. Ảnh agent chọn có thể được thay bằng ảnh đúng hơn.
- Nguồn wallpaper và gallery ảnh AI bị chặn mặc định. Fan-art, trang tổng hợp và giấy phép web không rõ được đánh dấu rủi ro cao.

## TASK-075 · Đồ hoạ tắt, một khung, hoặc chuyển động

- Ngân sách chọn đồ hoạ cảnh: ECO tắt, BALANCED một khung, QUALITY chuyển động, MAX thêm hạt nhiễu. CUSTOM chọn được.
- Tab Render hiện khoảng phút cho phần dựng cảnh trước khi bấm Render. Khoảng này không gồm giọng, nhạc, phụ đề và lần ghép cuối.
- Trợ lý và MCP trả cùng ước tính khi chạy render hoặc xem kế hoạch cảnh quay.

## TASK-073c · Kiểm tra tài khoản và lệch chỉ số

- Cài đặt → Tri thức có checklist **Tài khoản và video**, ghi thời điểm và kết quả đối chiếu thủ công.
- Trạng thái chưa rõ không được suy thành strike hay bị gỡ; giữ đăng giới hạn theo đúng tài khoản.
- Detector chạy theo lịch, có offline/ECO và mở điều tra khi đủ bằng chứng lệch chỉ số.
- Nhận webhook TikTok có chữ ký, đối chiếu số liệu eligibility và nhập chỉ số ngày từ dashboard khi connector chưa có dữ liệu.

## TASK-077 · Ảnh lệch chủ đề thì hỏi bạn

- Cảnh có ảnh lạc đề, bị AI nhìn loại, không có ảnh đúng, hoặc ảnh từ nguồn rủi ro cao thì ở trạng thái **Cần bạn**, kể cả khi dự án đang AUTO.
- AUTO không tự duyệt ảnh sai và không thay bằng thẻ tiêu đề. Bạn tải ảnh, dán URL, chọn ảnh khác, tìm lại, hoặc bỏ ảnh của cảnh đó.
- Câu tìm của tác phẩm hư cấu kèm tên tác phẩm. Nguồn wallpaper và ảnh AI bị chặn mặc định; bạn vẫn sửa được danh sách.

## TASK-073b · Hộp thay đổi

- Cài đặt → Tri thức có tab **Thay đổi**. Lọc trạng thái và mức, bấm **Tiếp tục** hoặc **Đóng**.
- Việc mức cao hoặc nghiêm trọng còn mở hiện trong **Cần bạn xử lý**.
- Giữ đăng chỉ áp vào tài khoản hoặc nơi dùng dữ kiện vừa đổi.

## TASK-071 · Thị trường mục tiêu

- Chọn thị trường khi tạo hồ sơ hoặc trong tab **Định hướng**. Khi đổi thị trường, xem trước rồi chọn từng mặc định để áp dụng.
- Dự án mới nhận thị trường của hồ sơ. Kịch bản, ý tưởng chủ đề và giọng đọc mặc định dùng ngữ cảnh địa phương. Kết nối tài khoản hiện cảnh báo nếu dữ kiện ghi nền tảng chưa khả dụng.
- Trợ lý tính ngày hiện tại theo múi giờ trong Cài đặt thông báo. Lịch đăng dùng múi giờ khán giả của hồ sơ.

## TASK-068 · Nhiều cảnh quay

- Form kiểu dựng có **Cổ điển (ảnh tĩnh)** và **Nhiều cảnh quay (thử nghiệm)**. Không chọn thì app giữ cách cũ.
- Tab Render hiện thống kê cảnh quay. Footage có tên tác giả và giấy phép trong credits.
- Một cảnh dựng lỗi thì cảnh đó dùng ảnh tĩnh. Video vẫn được xuất.

## TASK-069 · Sửa lại kịch bản và cổng đăng

- Kịch bản chưa đạt thì app viết lại tối đa 2 lần và đưa lý do vào lần viết sau. Bạn sửa kịch bản hoặc bấm tạo lại thì vòng sửa về 0.
- Đăng nhiều kênh cùng lúc thì mọi kênh phải đạt. Một kênh kẹt khung giờ hoặc hết hạn mức thì không kênh nào được đăng.
- Agent nối bằng MCP có quyền ghi cũng phải qua cổng kịch bản, render và đăng.

## TASK-066 · Cổng chất lượng khi tự vận hành

- Agent không còn gửi điểm hay cờ tự duyệt trong tham số. App đọc điểm kịch bản, file render và điều kiện đăng từ dữ liệu đã lưu.
- Cổng chưa đạt thì được giữ và có một việc cần bạn duyệt. YouTube từ chối vì bản quyền thì hồ sơ tạm dừng tự động hóa.
- Bản tin trong ngày liệt kê video đã đăng, việc đang chạy và cổng đang giữ.

## TASK-065 · Giọng đọc khi mất mạng

- Lỗi mạng hoặc DNS của Edge được thử lại 4 lần, mỗi lần cách 30 giây. Hết lượt thì app chạy lại bước Giọng đọc sau 5 phút. Lỗi 401 hoặc 403 không thử lại.
- Bước bị quá giờ được thêm 50% thời gian ở lần chạy lại, tối đa 30 phút, riêng render là 2 giờ. Bước vẫn báo tiến triển thì được gia hạn thêm một lần. Thông báo hết giờ nói bằng tiếng Việt và chỉ chỗ tăng thời gian chờ.
- Tìm ảnh giữ cảnh đã tìm khi bước bị dừng giữa chừng. Lần chạy lại dùng lại các cảnh đó. Trợ lý chỉ đề xuất tăng thời gian chờ; bạn duyệt thì số mới mới được ghi.

## TASK-064 · Báo cáo thử nghiệm

- Agent nhận việc bằng `claim_skill_run` để không làm trùng một hồ sơ. Sau khi làm, `save_skill_report` lưu giả thuyết, chỉ số và ngày kiểm. Từ 07:00 giờ Việt Nam, báo cáo đến hạn được đối chiếu số đã có và nhận kết luận đúng, sai hoặc chưa rõ. Video mới dưới 48 giờ được lùi ngày kiểm. Danh tính agent chỉ là nhãn, không đổi quyền.

## TASK-063 · Kỹ năng kênh

- Trang Agent operator có mục **Kỹ năng trong repo**. Bảy skill vận hành kênh được nạp từ file. Sửa file rồi chạy lại operator. Skill không thêm quyền.

## TASK-062 · Cắt ảnh

- Nút **Cắt ảnh** trên từng cảnh. App không tự cắt trong quy trình. Ảnh đúng tỉ lệ còn 9/10 mỗi chiều. Ảnh khác tỉ lệ lấy khung lớn nhất đúng tỉ lệ video.

## TASK-061 · Ảnh không trùng

- Mỗi cảnh nhận một ảnh khác nhau. Hết ảnh thì cảnh dùng thẻ tiêu đề, không chép ảnh cảnh bên cạnh.
- Ảnh kho có watermark không được chọn tự động. Hồ sơ có **Chất lượng ảnh**: Tiết kiệm hoặc Tốt nhất.

## TASK-060 · Ảnh, model và webhook

- Ảnh lệch chủ đề được tìm lại trên web khi nguồn web đang bật. Tắt nguồn thì có một mục **Cần bạn**.
- Hết quota thì lượt gọi có thể dùng model tương đương, route của bạn không bị ghi đè.
- **Cài đặt → Thông báo** tạo webhook cho agent bên ngoài. Bí mật chỉ hiện một lần.

## TASK-059 · Lịch và hoàn tác

- 05:00 áp mục tiêu, sáng thứ Hai đối chiếu tiến độ, 21:00 có bản tin. Ở mức 80% chi, app chọn model rẻ hơn nếu điểm chất lượng vẫn đủ.
- Lượt tìm ảnh Brave được tính vào hạn mức. Nút hoàn tác làm đúng việc đã ghi: cấu hình, chủ đề, bài đăng, bình luận hoặc cổng.

## TASK-059 · Tự vận hành

- Có mục tiêu, góp ý, yêu cầu **Cần bạn**, nhật ký hoàn tác và nút **Dừng tự vận hành**. Xem [Tự vận hành](tu-van-hanh.md).
- Agent có thể đọc OmniRoute và sửa combo trong quyền đã cấp. Thêm kết nối mới vẫn cần khoá của bạn.

## TASK-059 · Phần 1

- Có màn hình đặt mức tự chủ toàn app và quyền từng hồ sơ. Xem [Tự vận hành](tu-van-hanh.md).
- Agent operator dừng các thao tác lặp và có thể đọc trạng thái mức chi theo app hoặc hồ sơ.
- Worker tạm dừng một bước hay lỗi theo từng hồ sơ và chỉ chạy một job thử sau thời gian chờ.
- Có thể đặt hạn mức chi ngày và tháng. Worker ưu tiên lựa chọn miễn phí ở ngưỡng 80% và chặn lời gọi LLM, TTS trả phí khi đạt 100%.
- Worker áp dụng trần render theo ngày và trần đăng theo từng tài khoản. Job vượt trần giữ nguyên trong hàng đợi.
- Có mục **Giám sát tự vận hành** để xem heartbeat, hàng đợi và các sự cố được phát hiện định kỳ.
- Khi server khởi động lại, app chạy bù lịch operator gần nhất trong sáu giờ và xử lý lịch đăng tự động bị lỡ.

## TASK-058

- Kiểm tra định dạng Client ID và Client Secret trước khi lưu. YouTube có nút kiểm tra ứng dụng trước khi đăng nhập.
- Kết quả OAuth báo bằng tiếng Việt. Trang **Tài khoản** có kết nối lại, xoá và thống kê kiểm tra riêng cho tài khoản chưa kết nối.

## TASK-056

- Trang **Kết nối** trong Cài đặt: nhập khoá AI, kho ảnh và tìm ảnh web ngay trong app, thêm nhà cung cấp tương thích OpenAI, đăng nhập OpenRouter để tự lưu khoá, nhập từ `.env`. Xem [Kết nối](ket-noi.md).
- Trang **Tài khoản** gom mọi kênh của mọi hồ sơ, có lọc, **Kiểm tra tất cả**, **Chuyển hồ sơ** và trình **Thêm tài khoản** từng bước.
- Thẻ **Thiết lập ban đầu** trên Bảng điều khiển.

## TASK-055

- **Computer Use** trong Agent operator, mặc định tắt: cấp quyền theo ứng dụng và thao tác, ứng dụng thử giả lập, nút dừng, giới hạn bước và thời gian. Bấm và nhập luôn chờ bạn duyệt.

## TASK-054

- **Quy tắc thông báo và đánh thức** trong mục Sự kiện cho chọn theo hồ sơ sự kiện nào báo Telegram và sự kiện nào đánh thức agent chỉ đọc.
- **Sự kiện** trong Agent operator cho phép xem các job và thao tác chờ, kèm model, lần thử và lỗi đã lọc.

## TASK-053

- **Đề xuất công cụ** trong Agent operator liệt kê các tool hoặc MCP còn thiếu do agent đề xuất.
- **Phiên bản skill** hiển thị bản nháp từ lỗi lặp lại, bằng chứng và phiên bản có thể khôi phục.
- **Phiên bản skill** chấm điểm từng phiên bản trên bộ tình huống, so với bản đang dùng, cho sửa skill thành bản nháp và có mục **Tổng hợp tự học**.

## TASK-052

- Trang **Nhà cung cấp AI** có so sánh model trên cùng bộ mẫu. Kết quả lưu số đo và cho biết ứng viên có đạt ngưỡng chất lượng hay không.
- **Cố vấn mô hình** chỉ đề xuất đổi khi có kết quả so sánh phù hợp và kiểm lại khi áp dụng.

- **Tiếp tục** trong Agent operator dùng lại kết quả đã ghi của lượt runtime model hoặc Cursor MCP. Lượt có thao tác chưa rõ kết quả yêu cầu kiểm tra trước khi giao yêu cầu mới.

- Tab **Ghi nhớ** trong hồ sơ cho phép thêm, sửa và xóa ghi nhớ. Agent tra cứu ngữ cảnh trong hồ sơ qua công cụ dùng chung.

- App đối chiếu trạng thái lượt đăng sau khi khởi động lại. Khi kết quả tải lên chưa rõ, lượt đăng hiện hướng dẫn kiểm tra trên nền tảng.

## OmniRoute nhìn nhiều ảnh — 2026-11-07

- Model OmniRoute được bật nhìn ảnh nhận tối đa 10 ảnh mỗi lần gọi. MCP `omniroute` được thêm vào `.cursor/mcp.json`.

## Skill điều khiển app — 2026-11-06

- MCP có thêm `list_vision_models`, `set_stage_timeout` và `retry_stage`. Skill `dieu-khien-app` bảo agent dùng các tool này khi tự thao tác app.

## Agent đổi model — 2026-11-06

- Tool `set_llm_models` đổi model của từng việc, của dòng mặc định, hoặc của nhóm đọc ảnh. Model gán cho việc đọc ảnh được đánh dấu vision nếu nhà cung cấp chưa bật ảnh.

## MCP gọi hết API — 2026-11-06

- Tool `app_api` gọi các API còn lại của app. Vẫn không gửi token, khóa, hay fallback trả phí.

## MCP có quyền thao tác — 2026-11-06

- MCP `video-agent` trong Cursor chạy các việc confirm ngay (pipeline, đăng, xóa, lịch), không tạo thẻ chờ. Vẫn từ chối secret, fallback trả phí và dự án được bảo vệ.

## Xác nhận và mức dùng trợ lý — 2026-11-06

- Rời trang khi kịch bản hoặc cảnh chưa lưu, bỏ sửa cảnh, kiểm tra lại ảnh bằng AI, và tạo lại metadata đã sửa đều hỏi bằng hộp trong app.
- Mỗi câu gửi cho trợ lý cộng vào trang **Mức dùng**. Nhóm theo Video thì trợ lý là một dòng riêng.

## Bản đề xuất — 2026-11-05

- Thẻ bản đề xuất liệt kê từng phần của kịch bản và số giây ước tính. Nếu đã có giá USD thì thẻ hiện số đó.

## Đồ họa — 2026-11-05

- Chip đồ họa nằm đúng chỗ trên thanh thời gian. Bấm chip thì khung xem trước đổi theo mẫu đó. Hồ sơ có ô tên kênh trên thẻ kết.

## Phong cách dựng — 2026-11-05

- Hồ sơ và dự án chỉnh được kiểu phụ đề, cỡ chữ, màu nhấn và khoảng cách giữa các điểm nhấn mạnh. Tắt hiệu ứng âm thanh thì kế hoạch dựng không còn tiếng hiệu ứng.

## Timeline — 2026-11-05

- Mỗi chuyển cảnh có ô giây (0,25–0,8). Kiểu Cắt không chỉnh giây. Khung xem trước đồ họa có nút Phát và thanh tua.

- Kế hoạch dựng có ô chuyển động từng cảnh. Bấm một từ trong lời thoại để thêm hoặc bỏ nhấn mạnh.

## Giao diện — 2026-11-05

- Dòng “đang tải” của dự án, kịch bản, cảnh, hình, giọng và phụ đề là tiếng Việt. Ô tìm dự án và form sửa kịch bản cũng vậy.

- Màu chữ, nền và làn timeline của cảnh, giọng và nhạc dùng cùng bảng màu với phần còn lại của app.

## Tài khoản — 2026-11-05

- Xóa tài khoản, ngắt kết nối, xóa thông tin ứng dụng, xóa file một bản render, xóa cảnh và xóa lệnh thường trực đều hỏi lại trước khi xóa.

## Quy trình — 2026-11-05

- Chạy, duyệt, chạy lại hoặc hủy một bước trên trang dự án hiện một dòng thông báo ngắn. Lỗi vẫn hiện trên danh sách bước.

## TASK-050 — 2026-11-05

- Mỗi dự án có thời gian tối đa riêng cho từng bước, tính từ độ dài và độ phức tạp.
- Trang dự án có khối **Thời gian tối đa mỗi bước**, nút **Tính lại** và ô bạn tự chỉnh.

## TASK-043 — 2026-11-05

- Kịch bản đi theo một mẫu: giải thích, danh sách, kể chuyện, tin, tin đồn và sự thật, hướng dẫn, hoặc video ngắn.
- Chưa chọn mẫu thì app tự chọn. Mẫu đã chọn nằm trên brief.
- Sau khi có kịch bản, trang kịch bản hiện **Bản đề xuất**: mẫu, góc nhìn, số cảnh và thời lượng.
- Chat góp ý có hoàn tác timeline. Nếu timeline đổi giữa chừng, app báo tạo lại đề xuất.
- Tab Token và trang tổng quan hiện **Ước tính vs thực tế** khi đã có bản đề xuất.

## TASK-042 — 2026-11-05

- Có lớp đồ họa động: thẻ tiêu đề, chữ động, số đếm, tên dưới, danh sách, trích dẫn, biểu đồ, thanh tiến độ và thẻ kết.
- Trang **Render** có nút **Cài trình render đồ họa**. Hồ sơ có ô **Bật đồ họa động**. Mặc định tắt.
- Timeline có dải **Đồ họa** và khung xem trước. Nếu render đồ họa lỗi, video vẫn xuất, chữ động quay lại chú thích phụ đề.
- **Xem nhanh 10 giây** kể tên đồ họa nằm trong đoạn đó.
- **Hoàn tác** timeline giữ giọng đọc khi file còn trong thư mục dự án, và bỏ giọng của cảnh khi file đã mất.

## TASK-041 — 2026-11-05

- Timeline có chuyển cảnh, kiểu phụ đề và nút **Tạo kế hoạch dựng bằng AI**.
- Hồ sơ có mục **Phong cách dựng**.
- Phụ đề không còn nhấp nháy khi hai câu cách nhau dưới 0,6 giây.

## TASK-046 — 2026-11-05

- Có trang **Nhà cung cấp AI**. Danh mục bắt đầu bằng stub, chưa phải kết quả nghiên cứu.
- Nhận định chỉ được ghi khi câu trích nằm trong trang đã lưu. Chỗ chưa có nguồn vẫn là UNKNOWN.
- **Áp dụng** định tuyến và **Cập nhật OmniRoute** chỉ chạy khi bạn bấm. Bản sao lưu lỗi thì không ghi combo.
- Tab **Đang dùng trong OmniRoute** có **Kiểm tra lại**. Tab **Năng lực và benchmark** có **Chạy đánh giá**.

## TASK-051

- Mục **Cursor operator** đổi tên thành **Agent operator**. Có thể chọn Cursor CLI hoặc provider LLM đã cấu hình cho web, Telegram và lịch chạy. Provider LLM gọi công cụ qua cầu nối JSON và chờ duyệt ở thao tác có rủi ro.
- OpenAI có đường function calling. MCP của agent chạy nền dùng registry để áp bước duyệt. Lượt dùng provider LLM được ghi ở trang **Mức dùng**.

## TASK-047 — 2026-11-05

- Có trang **Cursor operator** cạnh **Trợ lý AI**. Chat có thể chuyển giữa trợ lý tích hợp và operator.
- Operator làm việc bằng công cụ của app. Việc cần duyệt thành thẻ **Duyệt** / **Từ chối**. Không có nút nào để operator tự duyệt.
- Có lệnh thường trực, hàng đợi, nút **Dừng** và **Phiên mới**. Telegram dùng `/op`, `/tl`, `/status`, `/stop`, `/new`, `/orders`.
- **Tắt operator** chặn mọi lượt mới. Tick theo giờ mặc định tắt.
- 2026-11-09 — Sau khi server khởi động lại, cả lượt đang chờ lẫn lượt đang chạy đều có trạng thái thất bại và thông báo trong lịch sử chat.
- Khi Cursor CLI chưa đăng nhập, Telegram và chat báo chạy `cursor-agent login`, không còn câu lỗi chung.
- File quyền của operator chỉ còn `permissions`. Bản CLI hiện tại từ chối khóa `version` cũ.
- Thư mục operator nằm ngoài repo git, và MCP `video-agent` được duyệt sẵn để phiên CLI nhìn thấy công cụ.

## TASK-049 — 2026-11-05

- Menu bên trái chia nhóm **Tổng quan**, **Nội dung**, **Kết quả**, **Cài đặt**, **Trợ giúp**. Mỗi nhóm thu gọn được.
- Trên điện thoại, bấm **Menu** ở thanh trên để mở menu.
- Bấm **Tìm nhanh** hoặc `Ctrl+K` để nhảy tới trang, hồ sơ hoặc dự án.
- Trang chi tiết có đường dẫn (ví dụ Hồ sơ › Tên hồ sơ › Tự động hoá). Trang dự án có thanh bước hiện giai đoạn và việc tiếp theo.
- Tên menu đổi sang tiếng Việt: **Bảng điều khiển**, **Dự án**, **Phân tích**, **Tài chính**. Trang mở nhanh hơn, thông báo thành công/lỗi hiện ở góc màn hình.

## TASK-048 — 2026-11-05

- Có mục **Hướng dẫn** cuối menu, và dấu **?** trên mỗi trang để mở đúng chỗ.
- Có bộ hướng dẫn tiếng Việt: cài đặt, hồ sơ, dự án, ảnh, giọng, render, đăng bài, lịch, thống kê, bình luận, mô hình AI, trợ lý.
- Trợ lý và MCP tìm được hướng dẫn khi bạn hỏi cách làm, ví dụ cách kết nối Telegram.
- Trang hướng dẫn có ô tìm. Gõ `quota` để tới mục hạn mức.

## TASK-045 — 2026-11-05

- Tab **Quota** đọc số used/total thật từ OmniRoute sau khi bạn tự lưu token quản trị.
- Thẻ live thay cho ước tính khi bản đồng bộ còn mới. Model đã định tuyến mà chưa có quota được chỉ ra.
- Nút **Làm mới** và **Xoá token**. Token không hiện full.

## TASK-044 — 2026-11-05

- Có hạn mức miễn phí, thời gian chờ khi hết lượt, và chuỗi dự phòng ưu tiên model miễn phí.
- Chính sách **Chờ reset** hoặc **Dùng model trả phí**, kèm trần USD mỗi ngày.
- Hết lượt thì pipeline chờ, không tự chuyển sang trả phí nếu bạn chưa chọn.

## TASK-057 — Tri thức kênh trong pipeline

Thêm tab Tri thức, chỉ mục FTS5 tiếng Việt, embedding tuỳ chọn và ngữ cảnh có nguồn cho nghiên cứu, kịch bản, kiểm tra, metadata, gợi ý chủ đề và chat review. Xem và loại từng đoạn khỏi một dự án; lập lại chỉ mục trong nền; bình luận chỉ bật khi người dùng chọn.

## TASK-073a

- Thêm [Tri thức trong Cài đặt](tri-thuc-va-thay-doi.md#tri-thuc-ben-ngoai) để xem nguồn, nhập dữ liệu, duyệt và khôi phục. Quota tải YouTube được đếm riêng.

## TASK-116

- Thêm trang [Nhóm và lời mời](khong-gian-va-quyen.md#nhom-va-loi-moi), [Tài khoản của tôi](khong-gian-va-quyen.md#tai-khoan-cua-toi) (2FA, phiên, khóa API) và [Nhật ký hoạt động](khong-gian-va-quyen.md#nhat-ky-hoat-dong).

## TASK-132

- Tách khóa định danh agent, tri thức và doanh thu theo không gian; giữ lịch sử tri thức khi nâng cấp.
- Khóa API mới gắn với không gian hiện tại; khóa cũ có nút gắn một lần và mặc định chỉ dùng trong không gian mặc định của người tạo.
- Từ chối và ghi nhật ký khi khóa API yêu cầu không gian khác.
- Rà soát bàn giao: sửa quyền đọc trạng thái Tài nguyên máy; bổ sung hướng dẫn cho công cụ giám sát Hermes và tài nguyên máy.
## TASK-123

- Thêm MCP HTTP cho nhiều máy, gói kỹ năng/bài học chung, bộ đồng bộ Hermes và tab Fleet để xem lệch phiên bản, lệnh cron còn thiếu và cấu hình chung.
- Bản nháp kỹ năng giữ nguồn và phiên bản gốc, cần gộp khi xung đột; chỉ chủ app được bật tự dùng kỹ năng chỉ đọc đã qua đánh giá.
- Client MCP từ xa giữ quyền của chủ khóa API; không được tự nâng thành chủ workspace bằng header nguồn công cụ.

## TASK-074a

- Thêm trang Tự cải tiến và nút Tìm hiểu lại trong Tri thức: nghiên cứu có ngân sách, quote đã kiểm, báo cáo và đề xuất chờ duyệt.
- Thêm sáu hướng nghiên cứu, nhật ký và các công cụ tìm/đọc/kiểm nguồn; ưu tiên tri thức cũ rủi ro cao, ECO chỉ chạy thủ công, lịch tuần tạo sẵn nhưng tắt.
