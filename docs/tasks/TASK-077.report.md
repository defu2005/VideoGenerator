# TASK-077 · Cổng liên quan cho ảnh

Cổng tính lúc đọc, dùng chung cho review, `approveAll`, precheck render và assistant. Ảnh AGENT lệch chủ đề, bị vision loại, không có ảnh đúng, hoặc nguồn rủi ro cao là `NEEDS_ATTENTION`, không `READY_FOR_RENDER`. Ảnh `USER` / `CUSTOM` / `AI_GENERATED` vẫn sẵn sàng.

`approveAll` trả `{ approved, failed, skipped, skipReasons }`. AUTO tìm web thêm và chỉ duyệt ảnh qua cổng. Không duyệt ảnh xấu nhất, không đổi thẻ tiêu đề. Còn cảnh lỗi thì một báo cáo `VISUAL_NEEDS_USER` mức WARN và một thông báo liệt kê cảnh. Đã bỏ đường `VISUAL_LOW_FIT` tự duyệt.

Ảnh AGENT được thay khi ảnh mới qua cổng và điểm cao hơn. Lịch sử nằm trong JSON vision meta. Không đổi schema DB. Query có tên tác phẩm. Brave thêm từ loại trừ nếu từ đó không có trong cảnh. Tác phẩm hư cấu tìm web ngay vòng đầu, trong hạn mức ngân sách. Denylist mặc định thêm wallhaven, craiyon, prompthero, stablediffusionweb, lexica, civitai. Reddit và fan-art ở lại pool, không tự duyệt (`source_risk`). Provider HTTP 404/410 bị khoá cả lượt ngay lần đầu. Grounding 404/410 dừng các batch sau. Không làm xoá watermark hay cắt né bản quyền.

File chính: `packages/shared/src/visuals/sceneQuery.ts`, `rank.ts`, `dedupe.ts`, schema visual/vision/autoReport/notifications/webImage, `featureMap.ts`; `apps/server/src/services/visualService.ts`, executor, orchestrator, `config.ts`, API visuals, test visualRelevance/autoReport/visualSearch/visualsApi/changeEvents; UI `VisualReview.tsx`, `AutoReportPanel.tsx`; hướng dẫn `hinh-anh-va-giong-doc.md`, `nhat-ky-thay-doi.md`. `renderService.ts` chỉ đổi tên biến ngân sách `graphics` thành `budgetFeatures` vì trùng tên với mảng đồ hoạ (agent khác), để server biên dịch được.

Test 11-11-2026, 16:24 ICT: shared `sceneQuery` 4/4. Web guideCoverage + VisualReview + AutoReportPanel 12/12. Server 15:50 ICT: visualRelevance, autoReport, changeEvents, visualsApi, visualSearch 46/46. Assertion cũ đã đổi vì query có prefix chủ đề, lý do Cloudflare tiếng Anh, và `approve-all` có `skipped`.

Live dự án Berserk `1ef6de1f-cf84-4552-8aed-8958f290bc0e`: chỉ chạy lại VISUAL_SEARCH, không duyệt, không render, không đụng `56374fb2-54cf-48ff-9441-2e6c653295d4`. Ba lần không ghi lựa chọn mới. Lần 1 quá hạn 30 phút. Lần 2 `LLM_UNAVAILABLE` sau 18,8 phút rồi thử lại. Lần 3 `LLM_AUTH` sau 6,4 phút, stage FAILED lúc 16:15 ICT. Ảnh cũ còn: sẵn sàng 0, cần bạn 31, tất cả `lowRelevance`. Không cảnh READY nào mang ảnh lệch. Ví dụ: cảnh 0 Pixabay thunderstorm (`pixabay.com/photos/flash-thunderstorm-ore-mountains-1455285`); cảnh 1 Pixabay samurai; cảnh 2 Wikimedia “Guts Cosplayer at Romics 2015”. Tab Hình ảnh hiện “Cần bạn · 31” và “Cần bạn · ảnh lệch chủ đề”.

Usage không ghi số Brave vì bước chết trước `recordUsage`. Lần 2 và lần 3 đều đưa 31 cảnh lệch vào web search, rồi Gemini grounding HTTP 404 đúng một lần rồi dừng. loc và met mỗi nguồn một dòng “blocked for rest” (lastBlockedAt 16:13 ICT). Inbox met 410 là một sự kiện `seen=3`, không phải 31.

Chưa xong ngoài phạm vi: `npm run typecheck` cả server vẫn lỗi `apps/server/src/knowledge/milestones.ts` dòng 20 và 58. File đó không được sửa trong task này. Chưa chạy `npm test --workspaces` và `npm run build` toàn repo sau sửa cuối. ECO có hạn mức web bằng 0 nên truyện hư cấu ở ECO không tìm web. Lần chạy live không tới `autoResolve`; đường AUTO dừng hỏi bạn được chứng minh bằng test `autoReport`.
