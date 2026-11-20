# TASK-074c-6j — kiểm thử hàng "Đã xong" có taskRef nhưng không có số IMP (báo cáo)

Trạng thái: chỉ thêm test trong `apps/web/src/features/operator/ToolProposals.test.tsx`. Không đổi `ToolProposals.tsx`, không đổi server, MCP hay `writeGuard.ts`. Không migration. Chưa commit, chưa push, chưa có `.done`. Không khởi động app.

## Mục tiêu

Giải quyết giới hạn 6 của báo cáo 6h: hàng có `taskRef` mà không có `impNumber` chưa có test. Hàm `doneLabel` (`ToolProposals.tsx:202`) phải bỏ phần IMP thiếu, không in "null" hay "IMP-".

## Thay đổi

- Một test mới trong `describe("TASK-074c-6h: read-only done section")`: "shows only the task name for a done row with a task and no IMP number". Dữ liệu: `impNumber: null`, `taskRef: "TASK-C"`. Khẳng định: nhãn đúng `done_c · Tool nội bộ · TASK-C`.

## Đây là test ghim, không phải test đỏ trước

Code hiện tại đã xử lý đúng, nên test xanh ngay khi thêm. Không có lần chạy đỏ trước khi cài. Bằng chứng khả năng bắt lỗi là mutant J1 bên dưới.

## Kiểm tra

- Focused `ToolProposals.test.tsx`: `Tests 41 passed (41)`, `VITEST_EXIT=0` (trước 6j: 40).
- Web typecheck: `npx tsc -p tsconfig.json --noEmit`, `TSC_EXIT=0`.

## Mutation

Driver: `scratchpad/mut6j.cjs`. Log: `scratchpad/mut6j.log`. Bản sao file gốc: `scratchpad/ToolProposals.6j.good.tsx`.

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| J1 | phần IMP luôn có: `const parts = [\`IMP-${item.impNumber}\`, item.taskRef]` | đỏ 1: "shows only the task name for a done row with a task and no IMP number" |

Mutant được khôi phục: `RESTORED_SAME true`, và `cmp` với bản sao gốc giống hệt.

Lần đầu driver không áp được mutant vì anchor xuất hiện 3 lần trong file (`ANCHOR_COUNT=3`); không có thay đổi nào sót lại, vì file được ghi lại từ bản gốc. Đã sửa anchor thành biểu thức có tiền tố `const parts = [`, duy nhất trong `doneLabel`.

## Giới hạn

1. Test là test ghim: xanh ngay từ đầu, chỉ có một mutant đỏ.
2. Chỉ kiểm nhãn trong danh sách; không kiểm trên trình duyệt.
3. Không kiểm trường hợp cả hai đều thiếu (`impNumber: null`, `taskRef: null`). Hàm trả về `null`, và hàng không có nhãn. Đây là hành vi chưa được ghim.
4. Vẫn còn các giới hạn còn lại của báo cáo 6h (8 mục: phân trang, thời điểm chuyển done, kiểm trên trình duyệt, chuỗi tiếng Việt chưa duyệt, và các mục khác) và của 6i.
5. Full web suite không chạy lại trong 6j. Lần chạy đầy đủ gần nhất là 299/299 (trong 6h, trước hai sửa chỉ-test). 6j chỉ chạy file `ToolProposals.test.tsx` và typecheck web.

## Chưa làm (cố ý)

- Test cho hàng thiếu cả IMP lẫn taskRef: chưa cần, vì hành vi đó chưa được quyết định.
- Mở rộng định dạng nhãn, kiểm trên trình duyệt: ngoài phạm vi.
