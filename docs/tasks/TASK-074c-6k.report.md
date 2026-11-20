# TASK-074c-6k — dismiss đề xuất công cụ chỉ cho người dùng (báo cáo)

Trạng thái: thêm kiểm tra người dùng cho route dismiss phía server, kèm test đỏ trước. Không đổi MCP, web, `writeGuard.ts`, policy, hay migration. Chưa commit, chưa push, chưa có `.done`. Không khởi động app.

## Phát hiện (từ 6i)

- Route `POST /api/operator/tool-proposals/:id/dismiss` (`apps/server/src/api/operator.ts`) không có kiểm tra `request.actor?.kind !== "user"`, khác với accept, start, check-done và draft.
- `dismissToolProposal` (`apps/server/src/operator/toolProposals.ts:174`) cũng không kiểm actor. Trong `apps/server/src`, chỉ route (`operator.ts:126`) gọi hàm này; không có bên trong tiến trình nào khác gọi trực tiếp.
- Không có caller HTTP nào khác ngoài web (`ToolProposals.tsx:95`) và MCP test (`tools.test.ts:711`, chỉ kiểm việc bị chặn). Không có test nào trên server ghim dismiss bằng khóa API là được phép. `registry.test.ts:393` gọi dismiss với `testActor` (kind user).
- Trước 6k, qua MCP chỉ guard `checkAppCall` chặn dismiss. Nếu guard đó bị bỏ, khóa có `operator.use` sẽ dismiss được.

## Thay đổi

- `apps/server/src/api/operator.ts`: thêm kiểm tra trước khi parse id, cùng mã và kiểu thông báo như accept:
  `if (request.actor?.kind !== "user") throw new AppError(403, "OPERATOR_TOOL_PROPOSAL_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được bỏ đề xuất.");`
- `apps/server/test/toolProposalDismissUserOnly.test.ts` (mới, 2 test):
  1. Khóa API bị từ chối 403 với `OPERATOR_TOOL_PROPOSAL_USER_ONLY`, và hàng `open` vẫn `open`.
  2. Người dùng dismiss được hàng tool `open`, hàng thành `rejected`, trả 200.

## Chạy đỏ trước

Chạy test mới trước khi sửa route: test 1 đỏ với `expected 200 to be 403`. Test 2 xanh (hành vi người dùng không đổi).

## Kiểm tra

- Focused: `test/toolProposalDismissUserOnly.test.ts`, `registry.test.ts`, `toolProposalAccept.test.ts`, `toolProposalStart.test.ts`: `Tests 44 passed (44)`, `FOCUSED_EXIT=0`.
- Server typecheck: `npx tsc -p tsconfig.json --noEmit`, `TSC_EXIT=0`.
- Full server suite: `Test Files 296 passed | 4 skipped (300)`, `Tests 2458 passed | 9 skipped (2467)`, `FULL_EXIT=0`, không có dòng FAIL. Log: `scratchpad/full-server-6k.log`. Số test tăng 2 so với 6g (2456).

## Mutation

Driver: `scratchpad/mut6k.cjs`. Log: `scratchpad/mut6k.log`. Bản sao route gốc: `scratchpad/operator.6k.good.ts`.

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| K1 | bỏ kiểm tra user-only khỏi dismiss | đỏ 1: "refuses an API-key caller with 403 and leaves the open row open" |

`RESTORED_SAME true`, và `cmp` của `operator.ts` với bản sao gốc giống hệt.

## Giới hạn

1. Kiểm tra chỉ phủ đường khóa API với `testActor`. Chưa chạy với khóa thật.
2. Test không xét dismiss với hàng đã đóng hoặc không tồn tại (đó là hành vi cũ, không đổi).
3. Không đổi quyền của khóa API. MCP lấy khóa từ `VG_API_KEY`, hoặc nếu không đặt thì từ `<DATA_DIR>/secrets/local-services.key` (`apps/mcp/src/apiClient.ts:42-59`). Theo đọc mã, khóa cục bộ (owner) có `operator.use`; khóa khác lấy vai thành viên của người tạo khóa. Chưa chạy thử với khóa nào.
4. Chuỗi thông báo tiếng Việt chưa được duyệt.
5. Chủ thể `system` (`workspaces.ts:122`) cũng bị từ chối, vì kiểm tra là `kind !== "user"`. Điều này chưa có test.

## Chưa làm (cố ý)

- Kiểm tra user-only cho các route khác (ngoài 4 route đã có và dismiss): không có phát hiện mới.
- Thay đổi policy `operator.use` cho khóa API: không làm; đó là quyết định bảo mật riêng.
