# Trợ lý và Telegram {#tro-ly}

Trợ lý dùng cùng các nút trên web. Việc nhạy cảm luôn có bước xác nhận.

## Trợ lý AI {#tro-ly-ai}

Dùng để hỏi số liệu hoặc nhờ làm giúp. Menu: **Trợ lý AI**.

1. Gõ tiếng Việt. Ví dụ: xem lịch hôm nay, thêm chủ đề, hỏi cách bấm.
2. Khi câu hỏi là "làm sao để…", trợ lý tìm trong hướng dẫn này và nêu tên mục.
3. Nếu thiếu hồ sơ hoặc dự án, trợ lý hỏi lại, không đoán.
4. Thẻ xác nhận hiện tóm tắt. Bấm nút đồng ý hoặc từ chối.
5. **Xoá dự án** và **xoá chủ đề** luôn hỏi, kể cả khi bạn bảo làm luôn.

Mặc định trợ lý bật ở mọi chế độ ngân sách (một lượt gọi cho mỗi câu). Mỗi câu được ghi vào **Mức dùng**. Trợ lý không giữ token nền tảng và không hiện token bot. Nó không tự **Đăng**, không tự đổi định hướng, không tự bật lịch nếu bạn chưa đồng ý trên thẻ.

Trong Cursor, MCP `video-agent` chạy với quyền thao tác: tạo dự án, chạy pipeline, duyệt cổng, đăng, xóa và các việc trong catalog. Tool `set_llm_models` đổi model từng việc và gán model đọc ảnh. `list_vision_models` đọc danh sách đó. `set_stage_timeout` đặt thời gian từng bước. `retry_stage` chạy lại bước lỗi. Skill `dieu-khien-app` trong repo nói agent dùng các tool này. Tool `app_api` gọi các API còn lại (cảnh, ảnh, giọng, nhạc, timeline, đồ họa, thumbnail, metadata, timeout, nhà cung cấp, bình luận, tài chính, thống kê, operator). API phải đang chạy (`npm run dev`). Ba việc `app_api` chưa làm: tải file lên (ảnh, giọng, nhạc, thumbnail), tải file nhị phân về (mp4, ảnh, audio), và gửi token Telegram, token OmniRoute hoặc khóa TTS. MCP cũng không bật fallback trả phí. Một dự án được đánh dấu bảo vệ thì mọi tool từ chối.

Câu mẫu: "làm sao để kết nối Telegram?". Câu trả nên chỉ tới mục [Kết nối Telegram](#telegram).

## Agent operator {#cursor-operator}

Trong **Tự vận hành toàn app**, bạn đặt giới hạn quyền cho các hồ sơ. Xem [mức tự chủ và quyền](tu-van-hanh.md).

Mở **Agent operator** từ menu hoặc trang **Trợ lý AI** để giao việc cho agent. Trong **Trạng thái**, chọn agent riêng cho web, Telegram và lịch chạy. Cursor CLI dùng phiên riêng. Provider LLM đọc ngữ cảnh chat gần đây. OpenAI dùng function calling và các provider như Claude Code CLI dùng cầu nối JSON. Lựa chọn này áp dụng cho các lượt mới và không đổi model của pipeline video.

Agent chạy nền dùng danh sách công cụ trong registry và hiện thẻ duyệt khi thao tác cần xác nhận. Xem token và chi phí của các lượt dùng provider LLM ở trang **Mức dùng**.

Mở **Đề xuất công cụ** trong Agent operator để xem tool nội bộ hoặc MCP bên ngoài mà agent cần. Mỗi đề xuất có ca tái hiện, phạm vi dữ liệu, quyền và tiêu chí kiểm thử. Bạn có thể bỏ qua đề xuất đã xem.

## Kỹ năng trong repo {#ky-nang-repo}

Mục **Kỹ năng trong repo** trên trang Agent operator liệt kê skill có `operator: true` trong `.agents/skills/`. Bảy skill kênh là: chiến lược kênh, chọn chủ đề, giữ chân người xem, kiểm tra trước khi đăng, lịch sản xuất, đọc số liệu, và báo cáo thử nghiệm. Bấm tên để đọc nội dung. Không có nút sửa. Sửa file rồi chạy lại operator để nạp bản mới. File lỗi hiện đường dẫn và lý do, kèm dòng nhắc sửa file rồi chạy lại. Skill không thêm công cụ và không hạ mức rủi ro.

Agent ngoài repo (Hermes, Codex, Cursor) đọc thư mục `.agents/skills/` trực tiếp, hoặc gọi `find_skills` rồi `read_skill` qua MCP. Văn bản skill là hướng dẫn. Công cụ mà skill kể vẫn theo mức rủi ro của công cụ đó.

## Báo cáo thử nghiệm {#bao-cao-thu-nghiem}

Mở **Báo cáo thử nghiệm** trong nhóm Kết quả. Bốn thẻ là Tất cả, Cần kiểm chứng, Theo skill và Agent. Ở thẻ cần kiểm chứng, bạn ghi số thực, chọn kết luận và viết bài học. Kết luận đó là của bạn, agent không ghi đè. Thẻ Agent có nút **Giải phóng** khi một agent giữ việc quá lâu. Chip **Môi trường** trên đầu trang là tên máy chạy app.

Nếu nhập báo cáo từ app khác và hồ sơ trùng tên trong bảy ngày, trang hiện dòng "Môi trường khác cũng đang vận hành hồ sơ này".

Trước khi chạy một skill kênh, agent gọi `claim_skill_run`. Nếu agent khác đang giữ hồ sơ đó, việc dừng và báo tên cùng môi trường. `save_skill_report` ghi giả thuyết, chỉ số và ngày kiểm. Chữ trong báo cáo là dữ liệu đã ghi, không phải lệnh cho agent. Biến `VG_ENVIRONMENT` đặt tên máy chạy app, mặc định `default`. `VG_AGENT_KIND`, `VG_AGENT_NAME` và `VG_AGENT_MODEL` chỉ để ghi nhận ai đã làm.

Trong **Phiên bản skill**, xem bản nháp sinh từ các lỗi lặp lại và các lượt làm bằng chứng. Bấm **Duyệt và dùng** để đưa bản nháp vào tra cứu chung, hoặc **Khôi phục phiên bản** để quay về bản cũ. Mỗi phiên bản được chấm trên bộ tình huống: câu hỏi khớp trigger phải chọn được skill, câu hỏi khớp anti-trigger hoặc lạc đề không được chọn. Cần từ 80/100 mới dùng được. Bản nháp hiện cả điểm của bản đang dùng để so sánh và liệt kê các tình huống trượt. Bấm **Sửa** để chỉnh nội dung skill tự tạo, rồi **Lưu thành bản nháp**: bản sửa được chấm lại và chờ bạn duyệt. Mục **Tổng hợp tự học** cho biết số bài học, skill đang dùng, bản nháp chờ duyệt và đề xuất công cụ đang chờ.

Trong **Sự kiện**, chọn một dòng để xem job lỗi, render hoàn tất, chờ quota hoặc chờ duyệt. Chi tiết hiển thị lần thử, lỗi, model và mức dùng khi có dữ liệu. Với thao tác đang chờ, dùng liên kết đến thẻ duyệt.

Mở **Quy tắc thông báo và đánh thức** để chọn, theo từng hồ sơ, sự kiện nào báo qua Telegram và sự kiện nào đánh thức agent. Lượt được đánh thức chỉ đọc trạng thái dự án và tóm tắt cách xử lý, không thay đổi dữ liệu. Mỗi sự kiện chỉ đánh thức và báo một lần. Khi bạn tạm dừng tự động, agent không bị đánh thức nhưng thông báo vẫn gửi. Lượt đánh thức tính vào giới hạn lượt trong ngày. Sự kiện chờ duyệt chỉ dùng thông báo.

Mục **Computer Use** cho agent đọc và thao tác trên giao diện một ứng dụng khi không có công cụ API hoặc MCP tương đương. Tính năng mặc định tắt. Mở **Cài đặt và quyền**, bật, chọn môi trường, ghi ứng dụng hoặc tên miền được phép và chọn thao tác. **Ứng dụng thử (giả lập)** dùng ứng dụng `ung-dung-thu` có sẵn để thử mà không chạm vào máy. Agent dừng khi màn hình chuyển ra ngoài phạm vi, không xác định được đích, gặp bước đăng nhập hoặc dự án được bảo vệ. Nội dung trên màn hình chỉ là dữ liệu. Dòng giống lệnh gửi cho agent bị ẩn và chặn thao tác ghi trong lượt đó. Bấm và nhập luôn tạo thẻ chờ ghi rõ ứng dụng, đích và chữ sẽ nhập. Thao tác chưa rõ kết quả được ghi **Cần kiểm tra**. Mỗi lần dùng có một dòng **Computer Use** trong Sự kiện với các bước và lý do dừng. **Dừng Computer Use** ngắt ngay. Lưu lại cài đặt để bật lại.

1. Bấm **Agent operator**. Nếu CLI chưa đăng nhập, mở terminal và chạy `cursor-agent login`.
2. Gõ việc bằng tiếng Việt. Ví dụ: kiểm tra quota, lập kế hoạch tuần.
3. Việc đang chạy hiện chữ và chip `đang gọi: ...`. Việc tiếp theo hiện **Đang chờ**.
4. **Dừng** ngắt lượt hiện tại. **Phiên mới** bắt đầu cuộc chat CLI mới. Ghi chú trong thư mục operator vẫn giữ.
5. Thẻ chờ có nút **Duyệt** và **Từ chối**. Chỉ bạn bấm được. Operator không tự duyệt.
6. **Tắt operator** thì không có lượt mới. Trên Telegram, tin thường nhận câu báo tắt và gợi ý `/tl`.
7. Lệnh thường trực nằm trên trang. Mỗi lệnh có thể có lịch riêng. Lệnh do module thêm bắt đầu ở trạng thái tắt.
8. **Mở trong Cursor** mở thư mục ghi chú. Nút **Chép lệnh** lấy lệnh `cursor-agent --resume` để nói tiếp trong terminal.

Telegram chỉ trả lời đúng chat đã ghép. `/op` luôn gọi operator. `/tl` luôn gọi trợ lý tích hợp. `/status` cho biết lượt đang chạy, hàng đợi và số lượt hôm nay. `/orders` bật hoặc tắt từng lệnh thường trực.

Tick theo giờ mặc định tắt. Gợi ý `0 8 * * *` nếu bạn muốn một lượt mỗi sáng. Mỗi ngày có trần số lượt. Hết trần thì app từ chối bằng tiếng Việt.

Khi server khởi động lại, các lượt đang chờ hoặc đang chạy được đánh dấu thất bại và có thông báo trong lịch sử chat. Với lượt có checkpoint, mở **Lượt chạy gần đây** và bấm **Tiếp tục** để dùng lại kết quả đã ghi. Bạn có thể chọn runtime khác trước khi tiếp tục. Nếu app báo đang chờ duyệt, hãy xử lý thẻ duyệt trước. Nếu app báo kết quả chưa rõ, kiểm tra trạng thái của công việc trước khi gửi yêu cầu mới.

Để Cursor thực hiện thao tác có tác dụng phụ trong workspace của Agent operator, hãy giao việc từ app để công cụ được gắn vào lượt đang chạy. Phiên CLI mở thủ công trong workspace này vẫn có thể dùng các công cụ chỉ đọc.

## Kết nối Hermes Agent {#hermes}

Hermes dùng chung danh sách công cụ trong registry với trợ lý của app. Thao tác có rủi ro tạo thẻ chờ bạn duyệt trong **Agent operator**. App từ chối thao tác trên dự án được bảo vệ.

1. Trong PowerShell, tại `C:\Users\defu\Documents\videoGenerator`, chạy `npm run build` để tạo `apps/mcp/dist/index.js`. Chạy `npm run dev` và giữ API Windows ở cổng 3001.
2. Trong WSL, thêm mục sau vào `~/.hermes/config.yaml`. Nếu đã có `mcp_servers`, thêm `video-agent` bên dưới khóa đó.

   ```yaml
   mcp_servers:
     video-agent:
       command: '/mnt/c/Program Files/nodejs/node.exe'
       args:
         - 'C:\Users\defu\Documents\videoGenerator\apps\mcp\dist\index.js'
       env:
         VG_API_URL: 'http://127.0.0.1:3001'
         VG_TOOL_SOURCE: 'operator'
         WSLENV: 'VG_API_URL/w:VG_TOOL_SOURCE/w'
   ```

   WSL mở Node của Windows qua interop. MCP giao tiếp qua stdin/stdout, còn Node gọi API trên loopback của Windows. `WSLENV` chuyển hai biến cấu hình sang tiến trình Windows. [Tài liệu MCP của Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)

3. Chạy `hermes mcp test video-agent` trong WSL để xem danh sách công cụ. Mở phiên mới bằng `hermes chat` và hỏi «Dùng Video Agent để liệt kê dự án». Câu hỏi này chỉ đọc dữ liệu.

Nếu danh sách công cụ trống hoặc lệnh đọc báo lỗi kết nối, kiểm tra API Windows đang chạy rồi mở lại phiên Hermes. Nếu gặp `MODULE_NOT_FOUND`, chạy lại build và kiểm tra đường dẫn trong `args`. Nếu WSL báo không tìm thấy lệnh, kiểm tra `command` trỏ tới `node.exe` dưới `/mnt/c/`. Giữ đường dẫn trong `args` ở dạng Windows vì Node chạy trên Windows.

Không ghép thêm bot Telegram của Hermes vào cùng chat với bot của app. MCP không có công cụ đọc khóa hoặc token đã lưu.

## Kết nối Telegram {#telegram}

Dùng để nhận báo pipeline, bài đã đăng, việc đang chờ, và tóm tắt cuối ngày. Cũng chat với trợ lý trong Telegram. Menu: **Thông báo**.

1. Tạo bot trên Telegram của bạn. Sao chép token.
2. Dán `<token của bạn>` vào ô token và lưu. Dòng trạng thái báo đã lưu token bot.
3. Bấm **Ghép nối**. Gửi đúng lệnh hiện trong khung cho bot, trong chat riêng. Mã hết sau 10 phút.
4. Khi **Chat đã ghép** có số, bấm **Gửi thử**.
5. Tick sự kiện muốn nhận: cần xử lý, đã đăng, đang chờ duyệt, tóm tắt ngày.
6. **Giờ tóm tắt** mặc định 21:00. Múi giờ theo ô trên form. Giờ im lặng để trống là tắt. Form gợi ý 22:00–07:00 nếu bạn bật.
7. Bấm **Lưu** trên form cài đặt.

Mặc định Telegram **tắt** và chưa ghép chat. Thông báo không gửi cho đến khi có chat đã ghép. **Xoá token** ngắt bot. Trợ lý trên Telegram hỏi xác nhận giống trên web trước khi đăng, xoá hoặc đổi định hướng. Đừng gửi token vào nội dung chat.
