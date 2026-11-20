# TASK-074c-4b-3c-1 — chặn chi tiêu lặp và chạy đồng thời khi soạn bản nháp (báo cáo)

Trạng thái: `checkProposalTarget` trong `apps/server/src/operator/proposalWriter.ts` và kiểm tra trước chi cùng guard trong tiến trình trong `apps/server/src/operator/proposalDraft.ts` đã code và test trong cây làm việc. Không route, không trang, không runner LLM thật, không migration mới. Chưa commit, chưa push, chưa có `.done`.

## Đã làm

- `proposalWriter.ts`: tách `checkProposalTarget(root, fileName)`. Trả `free` (kèm đường dẫn đích) hoặc `refused` với một trong `bad_name`, `bad_root`, `unsafe_target`, `exists`. Không ghi, không tạo thư mục. `writeProposalDraft` gọi lại hàm này và giữ nguyên thứ tự: name → content → root → target. Cờ `wx` vẫn là lớp dự phòng.
- `proposalDraft.ts`:
  - Guard trong tiến trình: `WeakMap` từ handle DB sang `Set` các id đang chạy. Kiểm tra và thêm không có `await` ở giữa. Xoá trong `finally`. Lần gọi trùng trả `skipped in_flight`, không chi, không gọi runner.
  - Kiểm tra đích sau `assignImpNumber` và trước khi chi `llmCalls`. Bị từ chối thì trả `refused` với lý do của bộ ghi (kể cả `bad_root`, `unsafe_target`, `exists`). Không chi, không gọi runner.
- `proposalDraft.test.ts`: 17 test (13 cũ, 4 mới, một trong số 13 đã đổi tên).
  - Đổi tên "pins the known limit ..." thành "refuses a retry against an existing IMP-<n>.md before any spend or runner call, on every attempt". Tên cũ không còn đúng: thử lại không còn chi thêm. Bây giờ cả hai lần đều trả `refused exists`, spend 0, runner không gọi.
  - "keeps the row unmarked when IMP-<n>.md already exists": thêm runner không gọi và spend 0.
  - "refuses an empty draft as bad_content": thêm lần gọi thứ hai, cũng `refused bad_content`, runner gọi 2 lần. Đây là chốt để guard được giải phóng khi runner trả về bình thường, không chỉ khi ném lỗi.
  - Mới: "returns in_flight ..." (runner giữ promise ở lần đầu; lần hai trả `in_flight`; runner gọi 1 lần; spend 1; sau đó lần đầu hoàn tất thành `drafted`).
  - Mới: "refuses an invalid root with the writer's reason ..." (root không tồn tại → `refused bad_root`, spend 0, runner không gọi).
  - Mới: "releases the in-flight guard when the runner throws ..." (lần đầu ném lỗi; lần sau chạy lại được và trả `drafted`).
  - Mới: "keys the in-flight guard by database and row ..." (hai db, cùng id ở db khác và dòng khác trên cùng db không bị chặn).

## Red trước code

- Lần chạy đầu sau khi viết test (trước khi có code): 3 test đỏ.
  - "keeps the row unmarked ..." và "refuses a retry ...": đỏ. Lý do "runner đã được gọi" là suy luận từ mã, chưa ghi thông báo lỗi trên cây trước code; M1 là lần đầu tiên thông báo lỗi được ghi.
  - "returns in_flight ...": lần đầu hết giờ 30 giây vì runner không bao giờ resolve. Đã sửa để runner ở lần hai resolve ngay. Trên cây trước code, test này chưa được chạy lại sau khi sửa; chỉ có M2 (bỏ guard) cho thấy nó đỏ trên khẳng định, với thông báo ghi ở mục Kiểm tra.
- Hai test được thêm cùng lúc với code, không chạy trên cây trước code: "refuses an invalid root ..." và lần gọi `bad_content` thứ hai. Chúng chỉ được chứng minh đỏ bằng M1 và M3.
- "releases the in-flight guard when the runner throws ..." xanh ngay từ đầu, vì chưa có guard nên không có gì để giải phóng. Test này chỉ có ý nghĩa khi guard có mặt, và M3 chứng minh điều đó.
- "keys the in-flight guard by database and row ..." được thêm sau khi code xong. Nó xanh trên code thật và đỏ dưới M4 (`Set` toàn cục), thông báo `expected { status: 'skipped', …(1) } to match object { status: 'drafted', impNumber: 1 }`.

## Kiểm tra

- Bốn tệp (`proposalDraft` 17, `proposalWriter` 28, `toolProposalImpNumber` 5, `improvementOpenSource` 14): 64 đạt, 1 bỏ qua (đo lại khi chạy bốn tệp cùng lúc, xem mục full suite). 1 bỏ qua là test symlink. Bỏ qua là `proposalWriter.test.ts:104` (`skipIf(!fileSymlinkAvailable)`, test symlink), vì máy này không tạo được symlink. Đây là skip có sẵn từ 4a, không do slice này.
- `npx tsc --noEmit` trong `apps/server`: EXIT 0 (đo sau khi hoàn nguyên).
- Mutation trên `proposalDraft.ts` (mỗi cái được hoàn nguyên từ bản sao và `diff` sạch):
  - M1 bỏ kiểm tra đích trước khi chi: 3 test đỏ ("keeps the row unmarked ...", "refuses a retry ...", "refuses an invalid root ...").
  - M2 bỏ guard in-flight: 1 test đỏ ("returns in_flight ..."). Thông báo: `expected { status: 'drafted', …(2) } to deeply equal { status: 'skipped', …(1) }`. Đỏ trên khẳng định, không còn hết giờ.
  - M3 giữ guard nhưng bỏ `running.delete(id)` trong `finally`: 3 test đỏ ("refuses an empty draft ..." ở lần gọi thứ hai, "refuses a retry ...", "releases the in-flight guard ...").
  - M4 `Set` toàn cục thay cho `WeakMap` theo handle DB: test "keys the in-flight guard by database and row" đỏ, thông báo `expected { status: 'skipped', …(1) } to match object { status: 'drafted', impNumber: 1 }`. Đã hoàn nguyên.
- Full suite (`npx vitest run --reporter=verbose` trong `apps/server`, log `scratchpad/server-full-3c1.log`, `FULL_EXIT=0`, chạy 16:13–16:18): Tệp 284 đạt, 4 bỏ qua (288). Test 2335 đạt, 9 bỏ qua (2344). 0 lỗi. Có đủ 17 dòng ✓ của `proposalDraft.test.ts`.
- Chạy lại riêng bốn tệp cùng lúc sau khi suite xong: 4 tệp, 64 đạt, 1 bỏ qua (65), exit 0. `npx tsc --noEmit` trong `apps/server`: EXIT 0.

## Trạng thái đóng

Code đã kiểm tra (17 test `proposalDraft` đạt, M1–M4 đỏ rồi hoàn nguyên). Advisor đã xem code (không có blocker trong `proposalDraft.ts` và `proposalWriter.ts`). Điều kiện đóng đã đáp ứng: full suite exit 0, 0 lỗi, 17/17 test `proposalDraft` có trong log; bốn tệp chạy lại cùng lúc xanh; không sửa code sau khi đo. **ĐÃ ĐÓNG** (advisor, 2026-11-20, trên trạng thái đã đo ở trên). Chưa commit, chưa `.done`.

## Giới hạn đã biết (ghi nhận, chưa sửa)

1. **Guard chỉ trong một tiến trình.** Hai tiến trình server cùng trỏ vào một DB không bị chặn. Đây không phải khoá DB; không có migration, không có cột claim.
2. **Dòng có file nhưng không có marker vẫn bị kẹt.** Khi `IMP-<n>.md` đã được ghi nhưng cập nhật `drafted_at` lỗi (hoặc file còn lại từ lần chạy trước), các lần thử lại trả `refused exists` và không chi. Hệ thống không tự nhận file cũ. Phải có người xoá file để soạn lại. Đây là quyết định của advisor.
3. **Giới hạn 3b số 1 (ghi xong nhưng marker lỗi)**: xử lý theo mục 2 ở trên. Lần thử lại không còn chi thêm.
4. **Giới hạn 3b số 7 (gọi đồng thời)**: xử lý trong một tiến trình. Giữa nhiều tiến trình, lớp `wx` và điều kiện `drafted_at IS NULL` vẫn là dự phòng; không có khoá.
5. **Giới hạn 3b số 6 (file mồ côi khi dòng rời `accepted` lúc runner chạy)** vẫn còn. Chưa có test riêng ngoài hai test `state_changed`.
6. **Migration 0100** vẫn chỉ áp dụng cho `:memory:` trong test, không áp dụng lên DB thật.
7. **Thử lại sau `bad_content` vẫn chi `llmCalls` mỗi lần.** Kiểm tra đích không bắt nội dung rỗng hay quá lớn, nên mỗi lần gọi đều chi và gọi runner (test ghim hai lần gọi). Đây là chủ đích của slice này; chỉ cần lưu ý khi làm 3c-2.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Route kích hoạt soạn bản nháp, runner LLM thật, dòng nhãn trên trang, tạo `docs/proposals/` (3c-2, sau khi advisor duyệt các báo cáo chỉ đọc).
- Chuyển `accepted` → `in_progress`.
- Áp dụng migration lên DB thật.
