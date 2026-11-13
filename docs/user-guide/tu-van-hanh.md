# Tự vận hành {#tu-van-hanh}

Mở **Agent operator → Tự vận hành toàn app** để đặt giới hạn chung. Trong **Hồ sơ → Tự vận hành**, chọn mức và quyền riêng của hồ sơ. Hồ sơ mới ở mức **Trợ giúp**. Quyền hiệu lực là phần quyền chung giữa hồ sơ và toàn app.

| Mức | Cách đặt quyền |
| --- | --- |
| Tắt | Không cấp quyền tự chủ |
| Trợ giúp | Duyệt thao tác rủi ro như trước |
| Có giám sát | Mẫu quyền gồm thử lại, chủ đề, chọn nhà cung cấp, cổng đến bước kịch bản và đăng riêng tư |
| Toàn quyền | Mẫu quyền rộng hơn. App liệt kê quyền và yêu cầu xác nhận trước khi lưu. Điều khiển màn hình tắt trong mẫu này |

Khi mức và quyền cho phép, app tự duyệt cổng, đăng bài và đổi cấu hình mà không mở thẻ chờ. Điều khiển màn hình vẫn cần quyền riêng. Bật tự động hóa và xoá dự án luôn cần bạn.

Cổng kịch bản dùng điểm đã lưu trên kịch bản. Không có điểm thì cổng được giữ và app hỏi bạn. Kịch bản chưa đạt thì agent viết lại tối đa 2 lần, kèm lý do chưa đạt. Cổng render kiểm tra file, độ dài, âm thanh và phụ đề. Cổng đăng kiểm tra metadata, ảnh bìa, khung giờ và hạn mức của từng kênh; một kênh không đạt thì không đăng kênh nào. Chủ đề nhạy cảm chỉ đăng riêng tư. Agent nối qua MCP với quyền ghi cũng phải qua các cổng này.

Nếu bạn vừa sửa tự động hóa, lịch, định hướng, model, giọng đọc hoặc thời gian chờ, agent chờ 24 giờ trước khi tự đổi mục đó. Cảnh báo thường trong khung 23:00–07:00 giờ Việt Nam được gom đến 7 giờ sáng. Cảnh báo nghiêm trọng gửi ngay. Nếu YouTube từ chối video vì bản quyền hoặc khiếu nại, app tạm dừng tự động hóa của hồ sơ đó.

Agent không được lấy hoặc thay khoá, đăng nhập thay bạn, nâng ngân sách, tự tăng quyền hay tác động lên dự án được bảo vệ. Các yêu cầu xoá vĩnh viễn dự án cần chủ app xử lý.

`update_stage_timeouts` chỉ đề xuất thời gian chờ mới. App đổi số sau khi bạn duyệt thao tác đó.

## Thao tác lặp và mức chi {#muc-chi-va-thao-tac-lap}

Trong một lượt Agent operator, lần gọi thứ ba với cùng công cụ và tham số bị dừng. Nếu cùng thao tác đã lỗi trong ba lượt khác nhau trong sáu giờ, lượt tiếp theo cũng bị dừng và app ghi nhận một sự cố.

Mở **Ngân sách tự vận hành** để đặt hạn mức USD theo ngày hoặc tháng. Để trống một ô ở hồ sơ để kế thừa cấu hình toàn app. Giá trị 0 chặn chi ngay. Hạn mức toàn app vẫn áp dụng dù hồ sơ đặt mức cao hơn.

Với mức **Có giám sát** hoặc **Toàn quyền**, worker ưu tiên các lựa chọn LLM và TTS miễn phí đã cấu hình khi đạt 80% và bỏ qua bước tìm ảnh web bổ sung bằng Brave hoặc Gemini. Từ 100%, lời gọi LLM hoặc TTS trả phí bị chặn. Job cần nhà cung cấp trả phí chờ tới kỳ ngân sách mới. App ghi một cảnh báo cho mỗi ngưỡng và kỳ chi.

Giới hạn số lượt render và đăng được giữ ngay khi worker nhận job, kể cả lần thử lại. Khi hết lượt, job chờ tới ngày tiếp theo theo giờ Việt Nam. Trần render toàn app tính tổng mọi hồ sơ. Trần đăng tính riêng từng tài khoản. Nếu chưa đặt trần cho kênh YouTube ở mức Có giám sát hoặc Toàn quyền, app dùng mức dự trù sáu lượt mỗi ngày. Quota thực tế của nền tảng vẫn có thể thấp hơn. Hạn mức lượt operator hiện áp dụng toàn app.

Với hồ sơ ở mức **Có giám sát** hoặc **Toàn quyền**, app tạm dừng từng bước sau ba lượt thất bại liên tiếp hoặc hơn năm lượt thất bại trong mười lượt gần nhất. Sau một giờ, app cho chạy một job thử. Nếu job thử thành công, bước đó chạy lại bình thường. Nếu vẫn lỗi, thời gian chờ tăng gấp đôi đến tối đa 24 giờ. Job đang chờ và công việc của hồ sơ khác được giữ nguyên. App ghi sự cố và gửi cảnh báo nếu bạn đã bật thông báo tự động hóa.

## Tự sửa chất lượng {#tu-sua-chat-luong}

Khi hồ sơ có quyền **Thử lại công việc** (mức Có giám sát hoặc Toàn quyền), một video không đạt cổng chất lượng được agent tự sửa thay vì chờ bạn. Cổng không đổi: video lỗi không bao giờ được đăng, ảnh sai không bao giờ được nhận, và các giới hạn cứng (khoá, đăng nhập, tiền, bản quyền và watermark, dự án được bảo vệ) giữ nguyên.

- **Kịch bản** dưới điểm tối thiểu, fact chưa vững hoặc vi phạm định hướng: viết lại theo lý do, rồi dùng model mạnh hơn, rồi chạy lại nghiên cứu, rồi đổi góc tiếp cận.
- **Ảnh cảnh** bị loại, thiếu kiểm tra, ít liên quan hoặc nguồn rủi ro: kiểm lại, chọn ảnh khác đã đạt cổng, tìm thêm, viết lại mô tả cảnh, cuối cùng đổi sang thẻ chữ, câu trích, danh sách hoặc bản đồ. Cảnh bạn đã chọn tay không bị đụng tới.
- **Video render** im tiếng, lệch phụ đề, đứng hình hoặc đen, lệch độ dài, mất file: chạy lại đúng bước gây lỗi rồi render lại.

Trong ô **Tự sửa chất lượng** của trang Tự vận hành bạn đặt số lượt sửa tối đa mỗi video (mặc định 6), số lần render thêm (mặc định 2), chi phí sửa tối đa và việc làm khi hết lượt. Chọn **Gác video lại** thì video chuyển sang trạng thái **Shelved**, chủ đề quay lại cuối hàng chờ một lần, và bản tin ngày có một dòng báo. Chọn **Hỏi tôi** thì bạn nhận yêu cầu kèm danh sách cách đã thử. Nếu ba video liên tiếp bị gác cùng một loại lỗi, app tạm ngừng tự sửa loại lỗi đó một giờ và gửi cảnh báo, vì thường là nhà cung cấp đang hỏng.

Agent chọn cách sửa trong danh sách cố định. Không có model hoặc ở chế độ ECO, app dùng thang mặc định từ rẻ đến đắt và không tốn token. Mọi lần sửa nằm trong Nhật ký tự vận hành.

## Giám sát định kỳ {#giam-sat}

Mở **Giám sát tự vận hành** để xem lần kiểm tra gần nhất, số job và các sự cố đang theo dõi. Khi worker chạy, server kiểm tra mỗi hai phút mà không gọi model. Heartbeat được giữ bảy ngày. Các kiểm tra theo hồ sơ áp dụng cho mức **Có giám sát** và **Toàn quyền**.

Supervisor phát hiện job vượt thời gian, tài khoản cần kết nối, thiếu chủ đề, lịch đăng chưa có bản render, job chờ quota và dung lượng đĩa thấp. Khi thiếu dung lượng, các job render của hồ sơ tự chủ chờ trong hàng đợi cho tới khi đủ chỗ. Nếu worker còn chỗ mà không nhận job đủ lâu, supervisor đánh thức nó một lần. Nếu vẫn không nhận job ở lần kiểm tra tiếp theo, app ghi sự cố cần xử lý.

Khi server khởi động lại, mỗi lịch operator có thể chạy bù một lần gần nhất trong sáu giờ, nếu tự động hóa đang bật. Với lịch đăng tự động bị lỡ dưới hai giờ, app vẫn xử lý lượt đăng. Lịch trễ hơn được chuyển sang khung trống nếu hồ sơ có quyền chiến lược. Nếu thiếu quyền hoặc khung trống, app ghi sự cố để bạn xem lại trước khi đăng.

## Mục tiêu và góp ý {#muc-tieu}

Trong hồ sơ, mục **Mục tiêu** nhận câu của bạn, ví dụ “1 video mỗi ngày lúc 20h”. App đọc thành kế hoạch và cảnh báo nếu số video vượt khoảng sáu lượt YouTube mỗi ngày. Góp ý như “giọng đọc chậm lại” được giữ thành quy tắc và đưa vào lời nhắc của bước kịch bản hoặc giọng đọc. Quy tắc mới trái với quy tắc cũ thì quy tắc cũ ngừng hiệu lực.

Trên Telegram, chủ kênh dùng `/goal`, `/feedback`, `/digest` và `/autonomy`. `/autonomy off` hạ quyền ngay. `/autonomy on` cần mã một lần hiện trên giao diện web. Tin nhắn từ cuộc trò chuyện khác bị bỏ qua.

Mỗi ngày lúc 05:00 theo giờ Việt Nam, app áp kế hoạch của mục tiêu đang bật vào lịch hồ sơ, không cần gọi model nếu kế hoạch đã có. Sáng thứ Hai lúc 06:00, app so số video đã đăng với mục tiêu. Nếu đang chậm và hồ sơ có quyền chiến lược, giờ đăng được dời thêm 30 phút. Bản tin lúc 21:00 liệt kê việc cần bạn và mục tiêu; một câu tóm tắt bằng model chỉ chạy khi hạn mức chi chưa đầy.

## Cần bạn {#can-ban}

Việc chỉ bạn làm được (khoá, đăng nhập lại, tiền) thành một dòng trong **Cần bạn xử lý** trên Bảng điều khiển, kèm nút mở đúng trang. App không gửi khoá qua Telegram. Yêu cầu mở quá 14 ngày được ghi là hết hạn trong bản tin tuần.

## Nhật ký và hoàn tác {#nhat-ky-tu-van-hanh}

Mở **Nhật ký tự vận hành** để lọc theo công cụ hoặc nguồn. Nút **Hoàn tác** chỉ hiện khi thao tác có cách đảo, và chỉ bấm từ giao diện của bạn. Hoàn tác cấu hình khôi phục bản đã lưu. Hoàn tác bài đăng chuyển video về riêng tư khi nền tảng cho phép và đánh dấu bài đã rút. Hoàn tác cổng chỉ mở lại khi bước sau chưa chạy. Khi bạn tự sửa một mục, agent không đụng lại mục đó trong 24 giờ trừ khi bạn yêu cầu.

## Dừng {#dung-lai}

Khi tự vận hành đang bật, thanh trên có nút đỏ **Dừng tự vận hành**. Một lần bấm đưa mọi mức về Trợ giúp và tạm dừng tự động hoá. Trước khi cập nhật app, gọi chế độ xả: server ngừng nhận job mới và chờ bước đang chạy xong.

## Chạy 24/7 trên Windows {#windows-24-7}

Tạo tác vụ trong Task Scheduler, chạy lúc đăng nhập, bật “restart on failure”. Khi cắm điện, tắt chế độ ngủ trong Power Options. App không dùng pm2. Sau khi máy ngủ hoặc khởi động lại, server chạy bù lịch gần và không đăng trùng bài.

## Kỹ năng dùng chung cho mọi agent {#ky-nang-dung-chung}

Mọi agent (trợ lý trong app, Hermes, Cursor, Codex, Claude) vận hành app từ cùng một bộ kỹ năng trong thư mục `.agents/skills`. Agent đọc `video-van-hanh-app` trước; kỹ năng này chỉ cách nối MCP `video-agent`, giới hạn cứng và bảng việc nào dùng kỹ năng nào. Các kỹ năng còn lại phủ dự án và pipeline, hình ảnh và giọng, render, đăng bài, bình luận, hồ sơ kênh, model AI, tự động hoá, xử lý sự cố và trích xuất kỹ năng.

Phần chỉ bạn làm (đăng nhập, kết nối OAuth, không gian và quyền, an toàn) không có kỹ năng thao tác; kỹ năng chỉ dẫn bạn tới trang hướng dẫn tương ứng.

**Agent đề xuất kỹ năng mới.** Sau một việc lặp lại, agent có thể gọi công cụ `propose_skill`. Kết quả luôn là bản nháp, không tự dùng. Trong **Vận hành → Phiên bản skill**, bản nháp ghi nguồn "Agent đề xuất", tên agent và lý do. Bạn chấm điểm rồi bấm **Duyệt và dùng**. Mỗi ngày tối đa 10 bản nháp.

**Đưa kỹ năng đã duyệt vào repo.** Chạy thử để xem kế hoạch, rồi ghi:

```bash
npm run export-skills
npm run export-skills -- --write
```

Lệnh chỉ xuất kỹ năng `video-*` đang dùng, ghi vào `.agents/skills/<tên>/SKILL.md`. File khác nội dung chỉ bị ghi đè khi có `--write`; lệnh không xoá file nào.
