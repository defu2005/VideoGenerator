# TASK-074a — Tự nghiên cứu có kiểm chứng

Đã tự review theo chỉ dẫn người dùng; không commit/push.

## Phạm vi và file
- `providers/web/{grounding,search,pages}.ts`: parser nguồn dùng chung với image search; search qua generateRoutedStructured/task research, chỉ metadata Gemini; query riêng tư được lọc và giới hạn 200 ký tự.
- `knowledge/officialPage.ts`, `providers/images/webCrawl.ts`: tái sử dụng một engine redirect/SSRF cho followRedirectsSafely, fetchHtmlSafe và nghiên cứu; robots kiểm từng hop, HTTPS, không cookie/login, body 2 MB, text/hash/cache 6 giờ, check_quote không mạng.
- `research/{service,runtime,skills,triggers,toolDefs}.ts`: Plan ≤6/Search/Read/Extract/Reconcile/Propose/Report do code điều phối; nguồn ưu tiên, quote kiểm thật, nguồn mâu thuẫn giữ cả hai và hạ độ tin cậy; chỉ outputKinds hợp lệ, không tự áp dụng medium/high.
- Bộ kiểm policy nhận trang do server vừa xác minh: bản làm mới low-risk đủ điều kiện vẫn tự áp dụng theo chính sách cũ; không phụ thuộc cache riêng của provider intel. Map này không phải tham số tool/API mà agent được tự gửi.
- `research_runs` theo workspace; migration 0078_friendly_multiple_man do Drizzle sinh. Lưu trạng thái, budget, báo cáo, nguồn/facts và proposal ids; liên kết change_event_id và reaction.researchRunIds, không đóng sự kiện/nhấc hold.
- `operator/{skills,repoSkills,skillVersions,service,workspace}.ts`: metadata research nhiều dòng/inline, sáu built-in, version/eval/activation qua đường cũ; phiên bản active thắng bản built-in khi routing/read_skill. Nháp research dùng ngân sách chung, ECO chỉ user edit/review.
- `operator/autonomyBudget.ts`, shared selfImprovement/schema: 6 bộ đếm theo workspace/ngày Việt Nam, reserve bằng transaction trước thao tác, cả fallback/lỗi vẫn tính lượt; mặc định 3/40/60/3/10/10.
- `ResearchHub` dùng route research hiện có, ghi jobs stage RESEARCH và usage/cost, kể cả lỗi có usage. Không thêm task LLM hay npm dependency.
- Model nhận page/subject như khối dữ liệu JSON escape, không thể đóng data fence; lọc email/khóa/tên riêng trước prompt, lọc số liệu ở subject/query. Model không được chọn công cụ hay các bước pipeline.
- AgentRuntime có web và beforeLlmCall: chỉ runtime được user chọn và có web mới chạy; output JSON được hub đọc lại nguồn và kiểm quote độc lập. Chưa có adapter cài sẵn nào khai báo web, nên UI hiện chỉ có Model; seam được kiểm bằng adapter giả.
- D6 ưu tiên stale high-risk, R5, user, lệnh tuần seed tắt; dedup mục hoàn tất 7 ngày, lỗi 1 ngày, tôn trọng ECO/giới hạn. Detector chạy theo từng workspace, không để agent nâng budget.
- `api/research.ts`: GET /api/research, GET /api/research/runs/:id, POST /api/research/runs, PUT /api/research/settings. Khởi chạy thủ công/đổi settings chỉ user có quyền; machine key không làm được.
- Registry: web_search/fetch_page/check_quote/list_research_runs là read; run_research luôn pending ở mọi nguồn/autoConfirm/grant, người dùng khởi chạy trực tiếp bằng nút xác nhận ngân sách.
- `registry/invoke.ts`: unknown tool vẫn trả UNKNOWN_TOOL, nay ghi audit refused trước khi trả; bao phủ yêu cầu chạy git/sửa code/dispatch CLI không tồn tại.
- Web: trang Tự cải tiến trong Vận hành, nghiên cứu/nhật ký, report/nguồn/proposal, budget/settings; Tri thức có Tìm hiểu lại và link báo cáo từ change event. `featureMap`, GUIDE_PAGES, mục lục, changelog và hướng dẫn đã cập nhật.
- Digest có mục Tự cải tiến 7 ngày, số lượt và số đề xuất. Skill repo video-tu-nghien-cuu và hub skill hướng dẫn quy trình/quyền.

## Kiểm chứng
- Lượt đầy đủ giữ nguyên mã: shared 752/752, MCP 30/30, server 1.322 qua + 6 skip, web chạy lại cuối 219/219 qua. Sau bổ sung một test low-risk, nhóm research/knowledge/policy/API chạy lại 17/17 qua.
- Typecheck/build toàn workspace đã qua; backend policy bổ sung và web tải báo cáo cũ theo ID đều được kiểm typecheck/build lại, qua.
- Nhóm chốt server (pipeline/web/budget/routing/policy/registry) qua; nhóm shared fetch/image/knowledge 29/29; nhóm regression gần nhất 54/54; nhóm skill/version/coverage 20/20.
- Lượt server 2 worker trên mã được giữ nguyên đã qua. Một lượt trước trộn source cũ/test vừa sửa nên lỗi link báo cáo và ưu tiên stale; đã bỏ kết luận của lượt đó, chạy lại đầy đủ và xác nhận xanh.
- Browser Chromium cổng 5180, API fixture toàn bộ: Tri thức → Tìm hiểu lại → report → proposal → report; lưu settings, desktop/375px không tràn ngang. Ảnh tmp/task074a-desktop.png và mobile.png đã xem; đã kiểm lại sau bố cục Vận hành và link hai chiều.
- Không có dev switch cho fixture search tổng quát: browser mock HTTP; core/API/runtime có test giả riêng, không mạng hay LLM/CLI thật.
- Browser bắt lỗi thông báo lưu bị mất do remount sau refetch: chuyển sang toast, sửa mock test để refetch trả settings mới, chạy lại qua.
- Link báo cáo ngoài 100 lượt gần nhất vẫn tải theo ID; có test giao diện riêng, không phụ thuộc danh sách mới nhất.
- Lượt toàn workspace bắt hai flaky cũ: test tick đi qua phút mới và chờ heartbeat 150 ms; sửa dùng cùng thời điểm tick và waitFor đúng điều kiện, assertions giữ nguyên. Một timeout Node CLI giả dưới tải hết khi giới hạn 2 worker, không nới timeout CLI.
- Drizzle generate lần cuối: No schema changes; quét UTF-8/NUL 363 file text thay đổi: qua. Không dùng dữ liệu thật hoặc dự án được bảo vệ.

## Nguồn và giới hạn
- Dùng code repo, chỉ mượn thiết kế STORM/Voyager/DSPy theo guide, không sao chép hoặc cài dự án bên ngoài.
- Đã đối chiếu [GenerateContent API](https://ai.google.dev/api/generate-content): groundingMetadata.groundingChunks.web.uri/title là metadata nguồn, không dùng URL trong text.
- knowledge_refresh giữ tên tương thích nhưng chuyển sang run_research; sáu skill mới dùng định dạng thông thường và được version/eval như skill khác.
- Search cần route Gemini có native grounding; thiếu route/key báo unavailable, không tự bật fallback trả phí. Token agent CLI chưa biết được ghi tokensUnknown, adapter web phải gọi hook trước từng lượt model.
- TASK-074b/c (behaviour/shadow/outcomes và guide cải tiến) chờ đúng đợt sau; không đánh dấu hai phần đó hoàn tất.
