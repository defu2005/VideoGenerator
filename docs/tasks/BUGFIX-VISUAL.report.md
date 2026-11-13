# BUGFIX-VISUAL · Đường ảnh, cổng chọn và tiến độ job

Đã đối chiếu mục 4, 5, 7 và 9 trong `PROPOSALS_AND_BUGS.md` với code hiện tại trước khi sửa. Một phần mục 5 và mạch HTTP 410 / Cloudflare đã có từ TASK-077. Không chạy pipeline trên dự án thật. Không đụng `56374fb2-54cf-48ff-9441-2e6c653295d4`. Không commit.

## Đã sửa

`localPath` là đường tương đối trong thư mục dự án (`visuals/<sha>.jpg`). Một hàm `resolveAssetPath(dataDir, projectId, localPath)` trong `apps/server/src/storage/paths.ts` ghép đường đó, hoặc nhận đường tuyệt đối nếu vẫn nằm trong thư mục dự án. Đường thoát ra ngoài thì ném lỗi. Hàm được dùng ở `ensureVisionLocalFile`, `visionCheckCandidate` (qua `visionCandidateFile`), `hashImage`, `review/service.ts` và `imageCrop.ts`. Không còn `join(..., "visuals", localPath)`. `getVisualFilePath` vẫn ghép tên file trần, đúng như API phục vụ file.

Ảnh nguồn thiếu ném `VISION_SOURCE_MISSING`. Ảnh dưới 64 px hoặc dưới 2 KB, hoặc không đọc được, là `invalid_source` và không gửi cho LLM (`VISION_SOURCE_INVALID`). Batch vision bỏ qua ảnh hỏng, không làm cả bước FAIL. Đã bỏ fallback JPEG trắng. Không xoá file placeholder đang nằm trong `data/`.

Cảnh AGENT có `lowRelevance`, vision loại, hoặc ở MAX mà chưa có kết quả AI nhìn thì `NEEDS_ATTENTION` / cần bạn, không `READY_FOR_RENDER`. Lý do mới: `vision_missing`, `invalid_source`. Ảnh `USER` / `CUSTOM` / `AI_GENERATED` vẫn sẵn sàng và không bị thay. Ảnh agent có thể bị thay khi ứng viên khác qua cổng và xếp hạng cao hơn, kể cả cảnh chưa đổi query. Sau tìm web, `autoResolve` gán lại từng cảnh rồi duyệt. Trong bước tìm ảnh, danh sách được khử trùng rồi `assignDistinct` một lần nữa sau vòng tìm thêm.

Denylist mặc định thêm wallpaper và gallery ảnh AI (wallpaperflare, wallpapercave, alphacoders, wallpaperaccess, wallpaperscraft, hdwallpapers.in, peakpx, wallpaperswide, nightcafe, seaart, tensor.art, openart, mage.space, leonardo, midjourney, playgroundai, artbreeder, pixai). Pinterest, pinimg, wallhaven, craiyon, prompthero, lexica, civitai đã có. `.env.example` khớp danh sách này. Host fan-art và trang tổng hợp (gelbooru, e621, imgur, tumblr, fandom, aminoapps, knowyourmeme, weheartit, artstation, behance, cùng reddit, deviantart, pixiv, furaffinity, zerochan, danbooru) ở lại pool nhưng không qua cổng (`source_risk`). Giấy phép `UNKNOWN` chỉ là rủi ro cao khi chưa xác minh, hoặc khi nguồn là Brave / web-grounding. Ảnh stock `UNKNOWN` đã `licenseVerified` chỉ bị trừ điểm xếp hạng.

`resumeRunningJobs` và `requeueRunningJobs` giữ tiến độ job và stage. `startJob` không đưa stage về 0 khi message là resume. Với `VISUAL_SEARCH`, nếu tiến độ đang 0 thì số checkpoint có thể nâng tối đa 55%. Script `dev` của `apps/server` dùng `tsx watch --exclude` cho `data/`, `tmp/`, `artifacts/` (cả đường từ `apps/server` và từ repo).

Hướng dẫn `docs/user-guide/hinh-anh-va-giong-doc.md`, nhật ký `nhat-ky-thay-doi.md`, `featureMap` mục project-visuals, và nhãn `VisualReview.tsx` có `vision_missing` cùng `invalid_source`.

## Đã có sẵn, không viết lại

TASK-077 đã chặn `lowRelevance` và vision loại đối với ảnh AGENT, giữ ảnh người dùng ở READY, và không thay khoá của người dùng. Circuit breaker từng lượt đã có: HTTP 410 và Cloudflare không thử lại, bỏ provider đó đến hết bước, dòng sức khoẻ nằm trong tóm tắt Visual Search (`met: unavailable (HTTP 410)`, `loc: blocked (Cloudflare)`). Test cũ vẫn xanh.

## Lệch so với chữ trong đề

- Không đánh mọi giấy phép `UNKNOWN` là rủi ro cao. Mock và stock xoay vòng CC0 / CC_BY / UNKNOWN với `licenseVerified` mặc định đúng; đánh dấu hết sẽ làm hỏng tìm ảnh.
- `packages/shared/src/compose/graphicKind.ts` thêm một annotation `Record<string, unknown>` để `tsc` của shared chạy được. Hành vi không đổi. File này chặn typecheck trước task; không sửa logic compose, render hay `renderService.ts`.
- Test “leaves unchanged scenes untouched” nay cho phép cảnh agent nhận ảnh xếp hạng cao hơn khi cảnh kia nhả ảnh. Khoá `USER` vẫn giữ nguyên ứng viên.

## Kiểm tra

12-11-2026, khoảng 00:52 ICT: `vitest` riêng `visionMax`, `visualSearch`, `visualRelevance`, `visionSource`, `imageCrop`, `orchestrator`, `autoReport` — 7 file, 61 test, xanh. Không mạng, không LLM thật.

`npm run typecheck` xanh ngay sau bộ test đầy đủ (khoảng 01:00 ICT): shared, mcp, server, web.

`npm test` đầy đủ, bắt đầu 00:53 ICT, khoảng 4 phút:

- `@vg/shared`: 76 file, 593 test, xanh.
- `@vg/mcp`: 1 file, 19 test, xanh.
- `@vg/server`: 110 file xanh, 2 file lỗi, 1 bỏ qua (113). Test: 938 xanh, 5 lỗi, 4 bỏ qua (947).
- `@vg/web`: 66 file xanh, 1 file lỗi (67). Test: 179 xanh, 5 lỗi (184).

Năm lỗi server và năm lỗi web không nằm trong diff của task này, và nằm ở vùng agent khác đang sửa:

- `originality.test.ts` (4): `buildTimeline` đọc `scene.visuals.filter` trong khi fixture vẫn truyền `visual: null`.
- `publishing.test.ts` “happy path”: `visibilityUsed` là `private` vì `evaluatePublishGuardrail` thấy bản kê nguồn chưa khớp timeline.
- `RenderPanel.test.tsx` (5): panel render không hiện chữ kỳ vọng; `OriginalityCard` gọi `data.findings.filter` khi `findings` chưa có.

Không sửa `compose/`, `render/` hay `renderService.ts`. Không mở trình duyệt: thay đổi người dùng thấy là nhãn lý do và đoạn hướng dẫn, đã được test đơn vị và `guideCoverage` trong bộ web xanh ngoài `RenderPanel`.

## Không làm

Không xoá watermark, không cắt ảnh để né Content ID. Không chạy pipeline dự án thật. Không đụng `.env`, `data/`, `scripts/`. Không thêm dependency. Không viết migration tay. Không commit.
