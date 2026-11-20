# TASK-074c-6c — nút "Đánh dấu đang làm" và mục "Đang làm" trên giao diện web (báo cáo)

Trạng thái: đã code và test trong cây làm việc. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. Không ghi vào `data/`, `data-dev/` hoặc `docs/proposals/`. Chỉ phía web: không đổi server, MCP hay migration.

## Phạm vi

- Nút "Đánh dấu đang làm" trên hàng đã chấp nhận có bản nháp (`draftedAt` có giá trị). Nút gọi `POST /api/operator/tool-proposals/:id/start` (route 6a). Chỉ hiện khi có bản nháp, khớp với điều kiện phía server.
- Mục "Đang làm" đọc `GET /api/operator/tool-proposals/in-progress` (route 6b), hiện số IMP và dấu bản nháp.
- Mọi lần start đều làm mới danh sách mở, đã chấp nhận và đang làm khi kết thúc, thành công hay lỗi. Không cập nhật lạc quan, vì route trả `{ok:true}` cả khi không có gì đổi.

## Thay đổi

- `apps/web/src/features/operator/ToolProposals.tsx`:
  - Thêm query `inProgress` (chỉ bật khi mở mục, cùng kiểu với danh sách đã chấp nhận).
  - Thêm mutation `start` với `onSettled: refresh`.
  - Thông báo lỗi của `start` và `inProgress` đặt ở cuối chuỗi `alertText`, để không che lỗi khác.
  - Hàng đã chấp nhận có bản nháp: hiện dấu và nút "Đánh dấu đang làm". Hàng chưa có bản nháp: giữ nguyên nút "Soạn bản nháp" (không có nút start).
  - Mục "Đang làm" với trạng thái đang tải và trạng thái rỗng.
- `apps/web/src/features/operator/ToolProposals.test.tsx`:
  - 5 test mới: nút chỉ hiện trên hàng có bản nháp; start rồi làm mới cả hai danh sách; lỗi start hiện alert và vẫn làm mới; mục đang làm hiện số và dấu, không có nút; mục đang làm rỗng.
  - Test 503 và 500 cũ (lỗi soạn bản nháp): thêm stub `GET .../in-progress` trả rỗng, để lỗi duy nhất trên màn hình là lỗi soạn bản nháp. Assertion alert được giới hạn trong `<details>` của mục (`within`).
  - Test lỗi start: cũng giới hạn assertion alert trong `<details>`.

## Kiểm tra red trước

- Chạy file test trước khi cài: 5 đỏ, 19 xanh (24 tổng). Các test mới đỏ đúng chỗ (không tìm thấy nút, không có mục đang làm).

## Sau khi cài

- Focused `ToolProposals.test.tsx`: 24/24 xanh.
- Web typecheck (`npx tsc -p tsconfig.json --noEmit`, trong `apps/web`): exit 0 (`scratchpad/tsc-web-6c-2.log`). Chạy lại sau khi sửa assertion dòng 313: exit 0 (`scratchpad/tsc-web-6c-3.log`). Sau đó chỉ sửa comment dòng 204 (không ảnh hưởng typecheck).
- Server typecheck sau khi đổi import test: exit 0 (`scratchpad/tsc-server-6c.log`).

## Mutation (mỗi cái một lần, hoàn nguyên từ bản sao lưu `scratchpad/toolProposals-web-6c-good.tsx`, `cmp` giống hệt)

- M1, thêm nút start vào nhánh hàng chưa có bản nháp (giữ nút soạn bản nháp, điều kiện `draftedAt` vẫn còn): đỏ 1 test, "shows the in-progress button only on drafted accepted rows". Đây là test giữ điều kiện. (Lần chạy đầu của M1 bỏ guard, không cô lập, cho đỏ 18: đó là kết quả thật của mutation không cô lập, không đo riêng điều kiện `draftedAt`. Lần redo bằng sed làm hỏng cú pháp file, không test nào chạy, và đã hoàn nguyên.)
- M2, `start` chỉ làm mới khi thành công (`onSuccess` thay `onSettled`): đỏ 1 test (lỗi 500 không làm mới).
- M3, bỏ `draft.error` khỏi chuỗi `alertText`: đỏ 2 test (503 và 500 soạn bản nháp). Lưu ý: lần chạy đầu của M3, khi assertion chưa được giới hạn trong `<details>`, cho 24/24 xanh. Nguyên nhân (đọc mã, `components/ui/Toast.tsx`): `MutationToasts` đẩy một toast lỗi `role="alert"` cùng nội dung khi mutation lỗi, nên `findByRole("alert")` không giới hạn vẫn tìm thấy toast khi alert trong mục bị bỏ. Chưa chạy lại mutation trên bản không giới hạn để xác nhận. Sau khi giới hạn assertion, M3 cho đỏ 2 đúng như dự kiến. Kết quả hợp lệ là lần sau.
- M4, bỏ `start.error` khỏi chuỗi `alertText`: đỏ 1 test (lỗi start). Assertion của test này đã được giới hạn trong `<details>` trước khi chạy M4.
- Sau mỗi mutation: hoàn nguyên bằng `cp` từ bản sao lưu, `cmp` xác nhận giống hệt. Focused 24/24 xanh sau khi hoàn nguyên M4.

## Kết quả full web suite

- Lần 1 (sau khi cài 6c): 95 file, 1 file lỗi (94 đạt); 283 test, 1 lỗi (282 đạt). Lỗi: `src/features/render/MetadataPanel.test.tsx > MetadataPanel > renders titles, saves edits, and copies blocks`.
- Chạy riêng `MetadataPanel.test.tsx`: 1/1 xanh.
- Lần 2 (toàn bộ `npx vitest run` trong `apps/web`): Test Files 95 passed (95); Tests 283 passed (283); `SUITE_EXIT=0`. Log: `scratchpad/web-full-6c-2.log`.
- Kết luận: không tái hiện được lỗi trong `MetadataPanel`. Nguyên nhân chưa biết, có thể là chập chờn (flaky). Chưa chứng minh được; file này không nằm trong phạm vi 6c.

## Giới hạn đã biết

1. Kiểm bằng test với fetch giả. Chưa kiểm trong trình duyệt; app không khởi động.
2. Hàng đang làm không có nút hành động nào. Chưa có đường chuyển sang done hay verified (cần thiết kế riêng, cùng với kiểm tra `.done`).
3. Nút start không có trạng thái thành công riêng: sau khi bấm, người dùng thấy hàng chuyển sang mục "Đang làm" khi danh sách làm mới xong.
4. Không có MCP nào đọc hay gọi route start hoặc danh sách đang làm.
5. Không có test cho trường hợp tải danh sách đang làm lỗi (`inProgress.error`). Lỗi đó vẫn hiện trong alert, nhưng chưa có test khóa hành vi này.
6. Lần chạy đầu của M3 cho 24/24 xanh do toast lỗi toàn cục `role="alert"` (`MutationToasts`) lặp lại nội dung lỗi. Giải thích bằng đọc mã, chưa chạy lại mutation trên bản không giới hạn (xem mục Mutation).

## Chưa làm (cố ý)

- Kiểm tra gated bằng `.done` và migration liên kết task (cần thiết kế riêng, advisor duyệt trước).
- So sánh 14/28 ngày; đường ghi `effort` và ánh xạ đầu ra cho 074c-3.
