# TASK-074c-3 — openSource cho yêu cầu M/L (báo cáo)

Trạng thái: phần điền `openSource` có kiểm ngân sách đã code và test trong cây làm việc. Đây chỉ là bước điền có kiểm ngân sách. Chưa có gì trong production gọi `fillOpenSource`, và chưa gọi `research-open-source`, nên dòng 62 của guide chưa hoàn thành. Chưa commit, chưa push, chưa có `.done`.

## Đã làm

- `apps/server/src/operator/improvementOpenSource.ts` (mới): `OpenSourceItemSchema` (zod), `isOpenSourcePending`, `fillOpenSource(db, id, runner)`.
- `apps/server/test/improvementOpenSource.test.ts` (mới): 14 test. Dòng được seed bằng INSERT trực tiếp, không gọi web hay LLM.
- Không có migration. Cột `open_source` và `effort` đã có từ 074c-1.
- `docs/tasks/TASK-074c-1.review.md` dòng 43: đã cập nhật. Nội dung nói rằng fix2 đã đóng lỗi dòng `open` hỏng nuốt lần lặp, và ghi các giới hạn còn lại.

## Thiết kế

- Thứ tự kiểm tra trong `fillOpenSource`:
  1. Không có dòng → `skipped / missing`.
  2. `open_source` khác NULL (kể cả `[]`) → `skipped / already_filled`, không gọi runner.
  3. `effort` không phải M hoặc L → `skipped / not_m_or_l`, không tiêu ngân sách.
  4. Tiêu `researchRuns` (không manual). Lỗi `SELF_IMPROVEMENT_BUDGET_LIMIT` hoặc `SELF_IMPROVEMENT_DISABLED` → `pending` với lý do tương ứng, không ném lỗi. Lỗi khác được ném lại.
  5. Gọi runner đúng một lần. Kết quả không phải mảng → `[]`. Mỗi mục qua zod; mục sai bị bỏ (ví dụ URL `http://`).
  6. Ghi `UPDATE ... WHERE id = ? AND open_source IS NULL`. Nếu `changes === 0`, một lần fill khác đã ghi trong lúc runner chạy, nên trả `skipped / already_filled` thay vì `filled`.
- Trạng thái "đang chờ" (pending) = effort M hoặc L và `open_source` NULL. Đây là hàm dẫn xuất `isOpenSourcePending`, không phải cột và không phải trường trả về qua API.

## Khác với guide (`docs/cursor/TASK-074c.md`, dòng 62)

- Guide dòng 62 gọi `research-open-source` trong ngân sách research. Bản này chưa làm bước đó. Nối runner thật cần tiêu `researchRuns` đúng một lần và có thể cần bước xác nhận của người dùng, nên để sau khi hỏi advisor.
- Guide viết: để `openSource` rỗng và đánh dấu `openSourcePending: true`. Bản này dùng NULL để nghĩa là đang chờ, và `[]` để nghĩa là đã tìm nhưng không có ứng viên.
- Không có trường `openSourcePending` được lưu hay trả ra API. Ngoài test, chưa có nơi nào đọc `isOpenSourcePending`, nên digest và giao diện chưa hiện trạng thái này.

## Quyết định của advisor (người dùng có thể đảo lại)

- Runner được tiêm vào, không nối vào `recordToolProposal`.
- Không có migration.
- Trạng thái đang chờ được dẫn xuất: NULL nghĩa là đang chờ, `[]` nghĩa là đã tìm và không có ứng viên.
- Kết quả không phải mảng được lưu thành `[]` và không thử lại. Để NULL sẽ thử lại và đốt ngân sách.

## Kết quả kiểm tra

- Red lần đầu: chạy trước khi có module, lỗi module không tồn tại (đúng dự kiến).
- Red có nghĩa (race): trước khi sửa bước ghi, test "không báo filled khi fill khác đã ghi" đỏ. Kết quả nhận được `filled, count 1`, kỳ vọng `skipped / already_filled`. Sau khi sửa (kiểm `changes`): xanh.
- Mutation: chuyển lời gọi runner lên trước bước tiêu ngân sách. Đỏ 4 test:
  - ngân sách đã hết,
  - ECO bật,
  - automaticResearch tắt,
  - runner ném lỗi (vì bản mutant chưa tiêu ngân sách nên `researchRuns` còn 0).
  Đã hoàn nguyên và chạy lại: xanh.
- Test tập trung `test/improvementOpenSource.test.ts`: 14/14 xanh (lần chạy cuối, sau khi hoàn nguyên mutation).
- `npx tsc --noEmit` trong `apps/server`: exit 0.
- Toàn bộ server suite (`npx vitest run`, apps/server, 2026-11-20 15:00): **Test Files 279 passed | 4 skipped (283); Tests 2265 passed | 8 skipped (2273); 0 failed; EXIT 0.** Thời lượng 405 s. Log: `scratchpad/server-full.log`.
  - Đối chiếu số file: lần chạy trước đó ghi trong `TASK-074c-2.report.md` (mục "Kiểm sau cùng") là 278 file, trước khi thêm case `find_skills`. Cộng `improvementOpenSource.test.ts` ra 279, khớp. Đối chiếu số test: 2247 + 14 = 2261, còn lệch 4 so với 2265. Phần lệch này khớp với 3 test của fix2 cộng 1 case `find_skills` nếu mỗi phần thêm đúng như vậy, nhưng chưa xác minh từng file. Không khẳng định là đã khớp.
  - `proposalWriter.test.ts` (074c-4a) được tạo sau khi vitest bắt đầu chạy, nên không nằm trong lần chạy này. Lần chạy sau (TASK-074c-4b-1, cùng ngày) có tổng 281 file passed và 2306 test passed, EXIT 0. Log không liệt kê theo file, nên việc có file này là suy từ phép cộng. Xem `TASK-074c-4b-1.report.md`.

## Giới hạn đã biết

1. Chưa nối runner thật. `research-open-source` chưa được gọi. Khi nối, không được tiêu thêm `researchRuns`, vì `ResearchService.run` đã tiêu một lần. Nếu runner cần bước xác nhận của người dùng (rủi ro "confirm"), phải hỏi advisor trước khi nối.
2. Hàm không kiểm `status` của dòng. Caller tương lai phải chỉ chọn các dòng còn mở. Gọi trên dòng done hoặc rejected vẫn tiêu ngân sách.
3. Runner ném lỗi: dòng giữ NULL, nên lần thử sau tiêu thêm một lần nghiên cứu. Lỗi được ném lại, không bị nuốt.
4. Hai lần fill đồng thời cho cùng một dòng: cả hai đều tiêu ngân sách. Chỉ một lần ghi được (guard NULL), lần kia trả `skipped` nhưng đã tốn một lần. Chưa có khóa trong bộ nhớ.
5. Runner trả về không phải mảng hoặc toàn mục sai: lưu `[]` và không thử lại. Giữ thiết kế này vì để NULL sẽ thử lại và đốt ngân sách (3 lần/ngày).
6. Không có đường ghi `effort` nào trong production. Grep `effort` trong `apps/server/src` chỉ thấy schema và phần đọc (`improvementRanking.ts`, `improvementOpenSource.ts`). `toolProposals.ts` không đặt `effort` khi INSERT. Không có import `improvementOpenSource` ngoài test. Vì vậy không dòng production nào tới được đường điền này. Cần một đường ghi `effort` trước thì wiring mới có tác dụng.
7. `isOpenSourcePending` chưa có người đọc trong production.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Ghi vào `data/` hoặc `data-dev/`.
- Nối runner thật vào `recordToolProposal`.
- Nối `research-open-source` làm runner thật (xem mục "Khác với guide").

## Bổ sung 2026-11-20 (advisor quyết định: không nối runner trong phiên này)

Ba sự thật đã kiểm, làm cơ sở cho quyết định đóng 074c-3 ở trạng thái hiện tại:

1. **Không đến được từ production.** Không có đường ghi `effort` nào trong `apps/server/src`. Không dòng production nào có `effort` M/L, nên `fillOpenSource` không bao giờ được gọi với dòng thật.
2. **Sai hình dạng đầu ra.** `ResearchService.run` (`apps/server/src/research/service.ts`) trả về bản ghi lượt nghiên cứu và ghi đề xuất tri thức (`knowledge.propose`). Nó không trả về mục `{name, url, licence, note}`. Runner thật cần một bước ánh xạ và có tác dụng phụ.
3. **Tiêu thêm ngân sách.** `ResearchService.run` tự tiêu `researchRuns` tại `service.ts:64`, cộng `llmCalls` và `webFetches`. Dòng này nằm ngoài khối `try`, nên lỗi ngân sách ném ra cho người gọi. Nối trực tiếp sẽ tiêu `researchRuns` hai lần.

Còn mở, cần quyết định thiết kế: (a) đường ghi `effort` cho `improvement_requests`; (b) ánh xạ từ kết quả nghiên cứu sang `openSource`. Dòng 62 của guide (`docs/cursor/TASK-074c.md`) vẫn chưa hoàn thành. Không có thay đổi mã trong bổ sung này.
