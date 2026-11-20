# TASK-074c-6i — kiểm thử MCP cho guard đề xuất công cụ (báo cáo)

Trạng thái: chỉ thêm test trong `apps/mcp/test/tools.test.ts`. Không đổi mã nguồn `apps/mcp/src`, không đổi server hay web, không tạo công cụ MCP mới, không migration. Chưa commit, chưa push, chưa có `.done`. Không khởi động app. (Phần server `dismiss` đã sửa ở 074c-6k, xem báo cáo đó.)

## Kết luận khảo sát (chỉ đọc)

- `app_api` gửi GET tới `/api/operator/tool-proposals/in-progress` và `/done`; guard MCP không chặn GET. Vì vậy không cần công cụ đọc MCP mới.
- `checkAppCall` (`apps/mcp/src/tools.ts:66`) chặn mọi method khác GET tới `/operator/tool-proposals`, sau khi giải mã phần trăm. Trước 6i, guard này không có test nào trong `apps/mcp/test`.
- Phía server, `ANY /api/operator/*` yêu cầu `operator.use` (`routePermissions.ts:122`). Quyền này thuộc vai owner (hoặc admin có cờ `adminsCanUseOperator`) (`policy.ts:39,69-70`).
- Khóa cục bộ (`localKey.ts`, file `<DATA_DIR>/secrets/local-services.key`) được tạo cho cùng `findOwnerId` mà `install.ts:78-84` dùng để gọi `ensureDefaultWorkspace`. `ensureDefaultWorkspace` thêm user đó vào không gian mặc định với vai `owner` (`workspaces.ts:52-55`). MCP dùng khóa này khi không đặt `VG_API_KEY` (`apiClient.ts:42-59`). Theo đọc mã, khóa cục bộ có `operator.use`, và GET đọc được qua server. Khóa do `VG_API_KEY` chỉ định có thể khác; theo đọc mã nó lấy vai thành viên của người tạo khóa. Chưa chạy thử với khóa thật.
- Server: các route POST `accept`, `start`, `check-done`, `draft` từ chối khóa API với `OPERATOR_TOOL_PROPOSAL_USER_ONLY`. Route `dismiss` trước đây không có kiểm tra này; 6k đã thêm vào.

## Thay đổi

- `apps/mcp/test/tools.test.ts`: một test mới, "app_api reads the in-progress and done proposal lists and refuses every write to tool proposals":
  1. GET tới `in-progress` và `done` không bị chặn; kết quả có `taskRef`; yêu cầu gửi đi đúng method và path.
  2. POST tới `start`, `check-done`, `accept`, `draft`, `dismiss` đều trả `isError` với thông báo "Chỉ người dùng xử lý đề xuất công cụ trong giao diện.".
  3. Biến thể mã hóa phần trăm `tool%2Dproposals/<id>/check-done` cũng bị chặn.
  4. Sau các lần chặn, số yêu cầu gửi tới server không đổi (2).

## Đây là test ghim hành vi, không phải test đỏ trước

Hành vi đã có sẵn, nên test xanh ngay từ lần chạy đầu (`tools.test.ts` 41/41). Không có lần chạy đỏ trước khi cài. Bằng chứng khả năng bắt lỗi là các mutant bên dưới.

## Kiểm tra

- Baseline trước khi sửa: MCP `npx vitest run` 7 file, 65/65.
- Sau khi thêm test: `test/tools.test.ts` 41/41.
- MCP typecheck: `npx tsc -p tsconfig.json --noEmit`, `TSC_EXIT=0`. `tsconfig.json` chỉ có `src/**/*.ts` và loại `test`, nên typecheck không bao phủ file test.
- MCP full suite: 7 file, 66/66, exit 0 (65 cũ + 1 mới).

## Mutation

Chạy bằng `scratchpad/mut6i.cjs` trên bản sao `scratchpad/tools.good.ts`. Log: `scratchpad/mut6i.log`.

| Mutant | Thay đổi | Kết quả |
|---|---|---|
| M1 | bỏ guard tool-proposals | đỏ 1 (test mới) |
| M2 | thu hẹp regex còn `tool-proposals$` | đỏ 1 (test mới) |
| M3 | chỉ chặn DELETE | đỏ 1 (test mới) |
| M4 | chặn cả GET | đỏ 1 (test mới) |

Cả bốn mutant đều được khôi phục: `RESTORED_SAME true`, và `cmp` của `apps/mcp/src/tools.ts` với bản sao giống hệt. `tools.ts` vẫn có 58 dòng thêm và 4 dòng xóa so với HEAD; đó là thay đổi chưa commit có từ trước, không phải của 6i.

## Giới hạn

1. Test dùng `fetch` giả. Nó chứng minh phía MCP, không chứng minh server trả dữ liệu đúng cho khóa MCP thật. Quyền `operator.use` của khóa MCP (khóa cục bộ hoặc `VG_API_KEY`) mới được suy ra từ mã, chưa chạy thử.
2. Test chỉ phủ POST con (`start`, `check-done`, `accept`, `draft`, `dismiss`, và biến thể `%2D`). Tên test nói "every write", nhưng không phủ: PUT/PATCH/DELETE, và POST tới đường dẫn gốc không có hậu tố. Mutant đổi thành `method === "POST"`, bỏ `|$` ở regex, bỏ cờ `/i`, hay bỏ `?#` sẽ không bị bắt. Không mở rộng test trong 6i.
3. Typecheck MCP không bao phủ `test/`.
4. Không có biến thể mã hóa kép (`%252D`). Suy ra từ mã rằng server giải mã một lần nên sẽ không khớp route, nhưng chưa đọc cách server giải mã và chưa test, nên đây chưa được xác nhận.

## Chưa làm (cố ý)

- Công cụ MCP đọc riêng cho danh sách `done` và `in-progress`: không cần, vì `app_api` đã gửi GET tới hai route này.
- Thay đổi quyền server: không làm trong 6i.
- Các mục bị chặn bằng cổng: start hay check-done qua MCP, 14/28 ngày, ghi `effort`, chuyển 074c-5.
