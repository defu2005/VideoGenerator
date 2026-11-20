# TASK-074c-5a — tự hiệu chỉnh hạn mức đề xuất 30% (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Mục kiểm toàn bộ suite và mutation ghi ở phần "Kết quả kiểm tra".

## Đã làm

- `apps/server/src/operator/improvementSelfTune.ts` (mới): `improvementSelfTuneStats` đọc 20 dòng đã quyết gần nhất; `effectiveImprovementRequestLimit` tính hạn mức hiệu lực.
- `apps/server/src/operator/autonomyBudget.ts`: `consumeSelfImprovementBudget` nhận thêm `limit?`. Giá trị này chỉ hạ hạn mức, không nâng được. Giá trị không hữu hạn bị bỏ qua, nên không thể tắt ngân sách.
- `apps/server/src/operator/toolProposals.ts` (quanh dòng 72): tính hạn mức hiệu lực từ hạn mức của người dùng và thống kê, rồi truyền vào consume. Nằm trong cùng giao dịch `immediate()` với thao tác ghi đề xuất.
- `apps/server/test/improvementSelfTune.test.ts` (mới): 11 test.

## Quy tắc

- Đã quyết = mọi trạng thái khác `open`. Đã chấp nhận = đã quyết và khác `rejected` (gồm `accepted`, `in_progress`, `done`, `verified`, `failed_verification`).
- Cửa sổ = 20 dòng đã quyết gần nhất, sắp theo `created_at`. Chưa đủ 20 dòng đã quyết thì quy tắc không áp dụng.
- Giảm nửa khi `accepted * 10 < 3 * 20`, tức dưới 30%. 5/20 bị giảm, 6/20 không.
- Hạn mức hiệu lực: `max(1, floor(n / 2))` khi `n > 0`; `0` giữ nguyên `0`. Không bao giờ cao hơn hạn mức của người dùng.
- Không lưu gì. Khi cửa sổ đổi, hạn mức tự phục hồi. Không ghi `app_settings`, không đổi `limits.improvementRequests`.

## Kiểm tra red trước

- Lần chạy đỏ duy nhất là lỗi thiếu module: `Cannot find module '../src/operator/improvementSelfTune.js'`. Log: `selftune-red.log`.
- Không chạy đỏ từng test. Test "không nâng quá hạn mức của người dùng" sẽ pass ngay cả khi chưa có implementation, nên nó chỉ được chứng minh bằng mutation 2.
- Mutation chỉ được chạy cho hai quy tắc: ngưỡng 30% (mutation 1) và giới hạn trần (mutation 2).
- Các quy tắc khác có test nhưng chưa được mutation: cửa sổ 20 dòng, loại trừ dòng open, sắp theo `created_at`, sàn 1, và dòng nối trong `toolProposals.ts`.

## Kết quả kiểm tra

- Focused: **7 file, 91 test, passed, EXIT 0.** Log: `selftune-green.log`. Số test theo file: `improvementSelfTune` 11, `selfImprovementBudget` 3, `improvementRequests` 19, `improvementOpenSource` 14, `improvementRanking` 8, `operator` 19, `registry` 17. Tổng 91. Đếm từ đầu ra verbose của lần chạy sau khi hoàn nguyên.
- `npm run typecheck` trong `apps/server`: **exit 0.** Log: `selftune-typecheck.log`. Lưu ý: tsconfig loại trừ `test/`, nên lệnh này không kiểm file test.
- Suite đầy đủ `npx vitest run` trong `apps/server` (sau khi code xong, trước mutation): **289 file passed, 4 skipped; 2374 test passed, 9 skipped; 0 failed; EXIT 0.** Log: `selftune-full.log`. So với lần chạy trước (288 file, 2363 test) thì tăng đúng 1 file và 11 test, khớp file mới.
- Mutation 1, `<` đổi thành `<=` ở ngưỡng 30%: **đỏ, 3 test** (5/20 và 6/20; "tính mọi trạng thái trừ rejected"; "phục hồi khi cửa sổ đổi"). Log: `selftune-mut1.log`. Đã hoàn nguyên.
- Mutation 2, bỏ `Math.min` và dùng `options.limit ?? limit của người dùng`: **đỏ, 1 test** ("không nâng quá hạn mức của người dùng"). Log: `selftune-mut2.log`. Đã hoàn nguyên.
- Sau khi hoàn nguyên: 7 file, 91 test passed, EXIT 0 (`selftune-restored.log`); typecheck exit 0 (`selftune-typecheck2.log`).

## Giới hạn đã biết

1. Trang chưa hiện tỉ lệ. Hình dạng API không đổi.
2. `selfImprovementBudgetStatus` vẫn trả hạn mức của người dùng, không phải hạn mức hiệu lực. Ai đọc trạng thái sẽ thấy 10 dù đang bị hạ còn 5.
3. Bảng `improvement_requests` không có `workspace_id`. Tỉ lệ chấp nhận là toàn cục, còn ngân sách theo từng workspace. Một workspace có thể bị hạ vì workspace khác.
4. Dùng `created_at` vì không lưu thời điểm quyết định. Nếu một hàng cũ bị cập nhật trạng thái sau đó, thứ tự cửa sổ có thể lệch.
5. Các hàng `dismissed` cũ đã được copy thành `rejected`. Một cài đặt có từ 20 đề xuất cũ bị bỏ trở lên sẽ bị hạ ngay sau khi migrate. Đây là đúng với đặc tả, nhưng người dùng nên biết. (Đã đóng bởi 074c-5d, 2026-11-20: hàng copy từ bảng cũ không còn đếm vào cửa sổ tự hiệu chỉnh.)
6. Tỉ lệ `verified` chưa được tách riêng; tính gộp trong nhóm đã chấp nhận.
7. Chỉ có một nơi gọi `consumeSelfImprovementBudget` với `"improvementRequests"` (`toolProposals.ts`). Không có đường nào khác bỏ qua việc hạ hạn mức. Chỉ `toolProposals.ts` ghi vào `improvement_requests`, và chỉ ghi hàng `kind = 'tool'`, nên truy vấn thống kê không cần lọc theo kind.
8. Chưa thấy trên giao diện; app chưa được khởi động.
9. Thông báo 429 không nói hạn mức đã bị hạ. Người dùng chỉ thấy "Đã đạt giới hạn đề xuất công cụ trong ngày." (Đã đóng bởi 074c-5c, 2026-11-20: khi việc hạ là nguyên nhân, thông báo nêu hạn mức đã hạ và `details`; xem `TASK-074c-5c.report.md`.)
10. Giới hạn trần âm hoặc `NaN` được xử lý trong code (`Math.max(0, ...)` và bỏ qua giá trị không hữu hạn) nhưng chưa có test. (Đã đóng bởi 074c-5c, 2026-11-20: hai test pin hành vi cap âm và cap NaN.)
11. Test kiểm chi tiêu đầu cuối dùng đồng hồ thật. Nếu chạy qua nửa đêm theo giờ Asia/Ho_Chi_Minh, ngày của `selfImprovementBudgetStatus()` có thể lệch với ngày của consume và test có thể flaky.

## Chưa làm (cố ý)

- Quy tắc chuyển trạng thái gated bằng `.done`, và `accepted → in_progress`.
- So sánh 14/28 ngày.
- Hiển thị tỉ lệ trên trang.
- Tỉ lệ `verified` riêng.
- Đường ghi `effort` và ánh xạ đầu ra cho 074c-3 (đã đóng cho phiên này theo quyết định advisor).
