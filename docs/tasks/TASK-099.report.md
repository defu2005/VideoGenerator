# TASK-099 — Diagram và timeline

Ngày triển khai 2026-11-16. Sub-agent triển khai và kiểm tra mẫu dựng. Root review, ghép feature map và changelog, rồi kiểm tra tích hợp cùng TASK-135a.

## Thay đổi

- `packages/shared/src/compose/structuredGraphic.ts`: schema sơ đồ 2–7 nút, liên kết có tham chiếu hợp lệ, ba bố cục; timeline 3–8 mốc, ảnh cục bộ tùy chọn qua `imagePath`; dò ngày/năm và ngôn ngữ quy trình; tính tỉ lệ trục trong code; khớp cả cụm từ để lấy thời điểm hiện.
- `packages/shared/src/compose/{schema,graphicKind,index}.ts`: thêm kiểu vào source union, danh mục graphic, duration bounds, timing và statistics; export qua compose/index đã có trong root index.
- `packages/shared/src/style/{genre,axes}.ts`: dữ liệu bật diagram cho explainer/how_to, timeline cho history/news_recap; manifest tokens-v1 cho hai mẫu, dùng picker/runtime có sẵn. Giữ các template cũ và token contract.
- `apps/server/src/compose/director/{kinds099,kinds070,llm}.ts`: candidate timeline bằng code, hướng dẫn trích payload trong lời gọi đạo diễn hiện có; kiểm tra nhãn/ngày thực sự nằm trong lời dẫn và sự kiện đúng câu; từ chối URL/ảnh AI tự gán. Payload sai lùi về danh sách trích từ lời đọc, hoặc ảnh/footage khi thời lượng không đủ.
- `apps/server/src/services/composeBridge.ts`: BALANCED chỉ dùng LLM cho cảnh có ngôn ngữ quy trình trong genre được bật, khi `editPlan` và đồ họa cho phép. Cảnh không chọn diagram giữ kế hoạch luật. QUALITY/MAX có thể tinh chỉnh timeline. Tái sử dụng task/route/cache/usage/budget feature `editPlan`; không thêm model, category hay dependency.
- `apps/server/src/compose/render/{graphic,graphicVars}.ts`: truyền style token, trục thời gian do code tính và timing; ảnh mốc chỉ đọc qua resolver của dự án, loại URL/mime ngoài danh sách, giới hạn 5 MiB rồi nhúng data URI. Template không truy cập mạng.
- `apps/server/assets/compose/{diagram,timeline}/index.html`: template mới độc lập dùng tokens-v1, chữ tiếng Việt, safe zones và entrance từ runtime; khung ngang/dọc. Mermaid/dagre và TimelineJS chỉ là ý tưởng bố cục, không chép source.
- `apps/server/src/compose/eval/structured099.ts`: fixture quy trình và ba sự kiện lịch sử ngoại tuyến.
- `apps/server/src/learning/loadRows.ts`: dùng danh mục GRAPHIC_KINDS chung để số liệu graphic share tính cả hai kiểu mới.
- `apps/web/src/features/render/ComposePlanPanel.tsx`: nhãn Sơ đồ/Dòng thời gian, giữ thao tác khóa; không đưa hai kiểu vào chuyển đổi thiếu payload.
- Tests: `structuredGraphic.test.ts`, `structuredGraphics.test.ts`, `structuredGraphicSamples.test.ts`, phần assert genre và RenderPanel, golden plan snapshots.
- Docs: `docs/user-guide/so-do-va-dong-thoi-gian.md`, `docs/compose/TASK-099.md`, bốn PNG tại `docs/compose/samples/task099/`; phần ghép root-owned files ghi trong `tmp/task099-integration.md`.

## Kiểm tra đã chạy

| Kiểm tra | Kết quả trước bàn giao |
|---|---|
| Build shared | Pass; root build lại source cuối trong full check |
| Shared toàn bộ | 765 pass, 95 files; trước refinement cuối của date parser |
| Server focused compose | 112 pass, 5 files; có 12 golden plan snapshots chỉ thêm thống kê bằng 0 |
| Structured server sau bổ sung rule timeline | 6 pass |
| Regression giới hạn nhãn vào shot span + director/genre | 83 pass, 4 files (`tmp/task099-span-tests.log`) |
| Server typecheck | Pass trước refinement cuối |
| Web typecheck | Pass |
| Web RenderPanel | 5 pass |
| Render thật 4 still bằng Chromium/HyperFrames/FFmpeg | 1 opt-in test pass, 96.57 giây |
| Dựng lại 2 diagram still sau sửa nhãn mũi tên | 1 opt-in test pass, 22.61 giây |
| Browser local, API mock | Pass: nhãn, khóa PATCH, khung 1440/375 px và không tràn ngang; chặn mọi request ngoài localhost |
| `git diff --check` trong scope | Pass |

Log: `tmp/task099-shared-suite.log`, `tmp/task099-server-focused.log`, `tmp/task099-structure-focused.log`, `tmp/task099-server-typecheck-final.log`, `tmp/task099-web-typecheck.log`, `tmp/task099-web-focused.log`, `tmp/task099-samples.log`, `tmp/task099-diagram-refined.log`, `tmp/task099-browser.log`.

Đã xem cả bốn ảnh và ảnh giao diện dọc. Vòng đầu phát hiện chữ nhãn mũi tên bị các nút che trong sơ đồ ngang; đã chuyển nhãn lên trên đường nối rồi dựng lại và xem lại. Bốn ảnh sample cuối đọc được, không bị cắt chữ ở safe zone.

Root review chỉ ra nhãn có thể nằm trong cảnh nhưng ngoài span do LLM chọn. Validation đã được giới hạn vào đúng từ `[start,end)` của shot, gồm cả cue quy trình. Regression xác nhận nhãn ngoài span không được thành diagram và dùng danh sách từ phần lời đọc hợp lệ.

Root bổ sung số test shared/server/web/MCP, kết quả build/typecheck/coverage và kiểm tra encoding cuối sau full check chung. Không dùng số focused để tuyên bố cả repo đã hoàn tất.

## Những assert cũ đổi có chủ đích

- `packages/shared/src/style/genre.test.ts`: hai kết quả disabledKinds được cập nhật theo danh mục diagram/timeline, không đổi quy tắc của tám kiểu cũ.
- `apps/server/test/__snapshots__/genreDirector.test.ts.snap`: đúng 24 dòng mới, 12 snapshot thêm `kindShare.diagram: 0` và `kindShare.timeline: 0`. Tất cả shots và các metric cũ giữ nguyên.
- `apps/web/src/features/render/RenderPanel.test.tsx`: fixture kế hoạch có thêm hai kiểu để kiểm tra tên tiếng Việt.

## Giới hạn và khác biệt với guide

- Guide phân công Fable thiết kế template riêng. Theo yêu cầu một sub-agent thực hiện task độc lập, sub-agent tự thiết kế hai template theo hệ token hiện có; không có output Fable được giả định hoặc nhận vơ.
- Giữ các cổng thời lượng/độ đa dạng và hook đầu video hiện có. Một candidate đủ ba mốc vẫn có thể không được chọn vì các cổng đó. Không nâng tỉ lệ đồ họa để ép mẫu mới xuất hiện.
- Timeline nhận date text nhưng proportional scale chỉ dùng năm hoặc ngày dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy hợp lệ, tăng dần và không quá sát nhau. Những trường hợp khác dùng thứ tự kể và khoảng cách đều.
- LLM chỉ trích từ lời dẫn, không tải ảnh hoặc tạo dữ kiện. Nếu thiếu word timings khớp, mẫu dùng nhịp ước tính có sẵn.
- Kiểm thử không gọi provider/CLI LLM/TTS thật và không có mạng. Smoke render dùng file giả trong thư mục tạm; không thao tác dự án thật hoặc protected project.
- Không migration, không npm dependency mới, không commit/push. Không sửa `.env`, `.claude/`, `data/`, root `scripts/` hoặc các file node/pipeline do root giữ.

## Kiểm tra tích hợp cuối

- Typecheck và build toàn repo đã qua. Shared 765 test, MCP 31, server 1.414 với 7 test bỏ qua, web 223. Web được chạy lại đầy đủ sau khi sửa đường dẫn hướng dẫn. Guide coverage và skill coverage đều qua.
- Root review mã tạo payload và mẫu dựng. Kiểm tra mới xác nhận nhãn chỉ được lấy từ lời dẫn trong chính shot. Kiểm tra UTF-8, NUL và `git diff --check` đã qua.
