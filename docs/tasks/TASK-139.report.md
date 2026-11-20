# TASK-139 — Xem trước nhanh

Hoàn tất triển khai và tự review ngày 2026-11-17.

## Hành vi và file

- `apps/server/src/preview/{service,planSource,shotRenderer,media,facts,tiling,toolDefs}.ts` tạo khung JPEG, sheet đầu/giữa/cuối từng shot và clip tối đa 3 giây. Dùng timeline/compose hiện có, hoặc selections khi timeline chưa hoàn tất. Mặc định cạnh dài 480, tối đa 1280. Clip có giọng và phụ đề khi đầu vào có sẵn.
- `shotRenderer.ts` dùng cùng template, GSAP, variables và motion helper. Adapter chụp trong Chromium sẵn có của HyperFrames, lấy đúng thời điểm rồi chỉ encode đoạn được yêu cầu. Adapter được resolve qua engine đã cài. Bộ dựng cũ là đường dự phòng khi adapter thiếu.
- Cache phiên bản 3 gồm spec, hash đầu vào, size, fps, version và sidecar đo chữ. Governor giới hạn preview và báo PREVIEW_BUSY. Tệp preview cũ đi qua GC của TASK-138, chờ một ngày sau khi đánh dấu.
- `facts.ts` đo chữ từ DOM tại lúc chụp khung đồ họa, đối chiếu title-safe của template. Hash ảnh và luma lấy từ JPEG. So sánh với shot liền trước trên toàn timeline, bổ sung chênh lệch màu để giảm báo trùng giữa ảnh màu phẳng.
- API `api/preview.ts`, registry assistant và MCP cung cấp ba tool đọc preview. MCP trả native image blocks cùng metadata. Project bảo vệ trả PROJECT_PROTECTED.
- `QuickPreview.tsx`, TimelinePanel và previewApi có strip ba ảnh, clip và sheet theo yêu cầu. Strip gọi tuần tự để phù hợp giới hạn hai slot. Không tự chạy khi vào trang.
- User guide, featureMap, changelog và skill `video-xem-truoc-nhanh` hướng dẫn cách dùng. Không thêm dependency hay migration.

## Kiểm chứng

- Preview đạt 18/18 test, bao gồm thời điểm animation, đo DOM, phân biệt màu phẳng, shot liền trước qua ranh giới scene, cache, governor, basis và bảo vệ trạng thái.
- MCP đạt 49/49 test, kiểm image blocks, loại ảnh sai định dạng, giữ metadata và hợp đồng candidate image cũ.
- QuickPreview/TimelinePanel và facts UI đạt các test tập trung. Browser trên Fastify/SQLite/Vite fixture tải ba JPEG, phát clip đúng 3 giây, mở sheet, không tự chạy preview trước thao tác. Cả năm POST và năm media GET trả 200. Stage và input version giữ nguyên sau baseline ban đầu. 375 px không tràn trang, không lỗi JS.
- Fixture lạnh 10 cảnh (7 quote graphics, 3 footage), QUALITY đo 1,553 giây/frame, 4,974 giây/sheet 30 ô và 5,056 giây/clip. BALANCED lần lượt 1,800 / 4,010 / 2,129 giây. FFprobe xác nhận clip 3,000 giây, 480×270, 15 fps và audio. Mọi ô sheet ghi cảnh, loại shot và thời điểm.
- Bằng chứng ở `tmp/task139-facts-review.md`, `task139-facts-full-tests.log`, `task139-facts-cold-quality.log`, `task139-facts-cold-balanced.log`, `task139-facts-sheet.jpg` và `task139-browser-review.md`.
- Workspace xác minh đã đạt shared 781, MCP 49, server 1.547 đạt / 7 skip, web 227 (`tmp/task138-workspaces-verified.log`). Typecheck và build toàn repo đạt ở `tmp/task138-sweep-typecheck.log` và `tmp/task138-frozen-build.log`. Delta preview/GC/provider sau khi thống nhất sweep đạt 34/34 (`tmp/task138-sweep-final-tests.log`).
- Lượt typecheck/build cuối đạt ở `tmp/task141-takeover-typecheck.log` và `tmp/task138-close-build.log`. Diff check và kiểm UTF-8/NUL đạt.

## Giới hạn

Phép đo DOM áp dụng cho chữ trong template tại khung lấy mẫu. Chữ đã nằm sẵn trong ảnh/footage và phụ đề burn-in dùng cách ước tính được gắn nhãn, chưa có OCR. Facts của sheet dùng khung giữa shot, clip dùng khung trong khoảng yêu cầu. Nếu không đọc được shot liền trước, khoảng cách để trống và preview hiện tại vẫn trả được.

Fixture chỉ chứng minh tốc độ trên nội dung và máy đã đo. Bộ dựng dự phòng khi adapter không có mất 11,566 giây cho khung đồ họa lạnh, vượt mục tiêu 3 giây. Những số này được ghi trong hướng dẫn. Không thao tác app dữ liệu thật, không gọi LLM/TTS CLI thật và không commit/push.

## Bổ sung sửa lỗi sau review Codex (Fix pass 1, 2026-11-17)

- **[P1] Ràng buộc tính tươi mới (freshness) của saved compose plan**:
  - `apps/server/src/preview/planSource.ts`: Thêm hàm thẩm định `isSavedPlanCurrent(saved, timeline, aspect)` để đối chiếu toàn diện:
    - Khớp tỷ lệ khung hình (`aspect`).
    - Khớp độ dài danh sách cảnh, ID cảnh, thứ tự từng cảnh và độ lệch thời lượng (`durationSec` lệch không quá 0.05s).
    - Khớp `candidateId` và đường dẫn tệp ảnh (`path`) của các visual giữa timeline hiện hành và saved plan (đối với các shot không bị khoá).
  - Bảo toàn shot khoá (`locked: true`): Hàm `extractLockedShots(saved)` trích xuất các shot đã khoá chỉnh sửa thủ công và chuyển vào `planProject({ lockedShots })` khi cần sinh lại plan tạm, đảm bảo không làm mất chỉnh sửa của người dùng.
  - Phòng thủ lỗi JSON / schema: Bọc việc đọc `compose-plan.json` trong try-catch kết hợp `ComposePlanSchema.safeParse`. Tệp hỏng hoặc không đúng định dạng được bỏ qua an toàn và sinh lại plan tạm dựa trên timeline hiện tại, không gọi stock/LLM và không làm đổi stage/inputVersion.
  - Bằng chứng tái hiện sau sửa: chạy `npx tsx tmp/codex-review-139-repro.ts`, kết quả lưu tại `tmp/codex-review-139-repro-after.log`:
    - `currentTimeline`: `visuals/new.jpg`, 4 giây.
    - `actualPreview`: `visuals/new.jpg`, 4 giây, `reusedStalePlan: false`.

- **Cơ chế ghi chú Fallback & Đo lường hiệu năng**:
  - `apps/server/src/preview/service.ts`: Khi fallback sang bộ dựng full-shot (`this.shotClip`), hệ thống ghi nhận ghi chú rõ ràng vào notes của preview: `"Đã dùng adapter dựng dự phòng (full-shot fallback)."`.
  - Giải trình fallback: Bộ dựng dự phòng (full-shot fallback) phải encode toàn bộ shot qua ffmpeg rồi mới seek cắt khung/đoạn, dẫn đến thời gian xử lý tăng cao khi gặp shot đồ họa phức tạp.
  - Kết quả đo lường benchmark lạnh (frame) được ghi nhận độc lập:
    - Môi trường kiểm soát (nhàn rỗi):
      - `direct frame`: 2.412 ms (~2.4s, đạt ngưỡng < 3s; lưu tại `tmp/task139-preview-cold-direct-after.log`).
      - `legacy fallback frame`: 25.023 ms (~25.0s, lưu tại `tmp/task139-preview-cold-fallback-after.log`).
    - Ghi nhận tải đồng thời trong review của supervisor: direct 32.600s, fallback 51.993s khi chạy đồng thời với nhiều worker khác.

- **Kiểm thử hồi quy**:
  - `apps/server/test/preview.test.ts`: Bổ sung 5 test case trong suite `preview plan freshness and validation regressions`:
    - Phát hiện plan cũ khi timeline đổi ảnh và sinh lại ảnh mới.
    - Phát hiện plan cũ khi đổi thứ tự hoặc thời lượng scene.
    - Tự điều chỉnh khi thêm hoặc xóa scene.
    - Xử lý an toàn khi `compose-plan.json` bị hỏng cú pháp JSON.
    - Bảo toàn các shot đã khóa (`locked`) khi sinh lại plan.
  - Toàn bộ 23/23 test trong `preview.test.ts` và 63/63 test trong 5 file tập trung đạt kết quả tốt với `--maxWorkers=2`.

## Bổ sung sửa lỗi sau review Codex (Fix pass 2, 2026-11-18)

- **[P1 Fix2] Dấu vết tươi mới hoàn chỉnh (complete freshness fingerprint) cho compose plan**:
  - Đã tái hiện offline qua `tmp/codex-review-139-cleared-image.ts`: khi visual đổi thành PLACEHOLDER (path: null), logic fix1 chỉ kiểm tra visual ảnh (`v.kind === "IMAGE" && v.path`) nên bỏ qua kiểm tra, tái sử dụng plan cũ chứa `visuals/old.jpg`.
  - Cập nhật hàm `isSavedPlanCurrent` trong `apps/server/src/preview/planSource.ts`:
    - Kiểm tra tính khớp FPS giữa `saved.fps` và `timeline.target.fps`.
    - Kiểm tra trường hợp ảnh bị xóa / chuyển thành PLACEHOLDER: nếu timeline không có visual ảnh mà plan đã lưu chứa shot still có đường dẫn, lập tức từ chối plan cũ.
    - Kiểm tra nhiều visual, đường dẫn ảnh, candidateId của từng visual đối chiếu với các shot không bị khóa (`!shot.locked`).
    - Kiểm tra đồ họa timeline (`timeline.graphics`): cảnh có đồ họa timeline yêu cầu plan tương ứng phải có shot đồ họa/kinetic phù hợp.
    - Bảo toàn tuyệt đối các shot đã khóa chỉnh sửa thủ công (`locked: true`).
    - Tái kiểm tra với `tmp/codex-review-139-cleared-image.ts`: `reusedStalePlan: false`.
  - Thêm persistent regression test trong `apps/server/test/preview.test.ts`: "detects stale plan when an image visual is cleared to a placeholder".
  - Chạy `npx vitest run test/preview.test.ts`: 24/24 tests đạt.

- **[P2 Fix2] Sửa đơn vị đo lường và minh bạch thời gian fallback**:
  - Sửa lỗi ghi đơn vị đo lường: kết quả đo cold frame được ghi rõ ràng theo **giây (seconds)**: direct cold frame đo được ~2.41s; legacy fallback cold frame đo được ~25.02s (vượt ngưỡng mục tiêu 3s do phải render full shot ffmpeg rồi mới seek trích xuất khung hình).


