# TASK-153 — automation pause phải áp cho cuộc gọi nguồn `agent`

**Who:** Claude viết guide; người thực hiện là Claude hoặc agent code khi user giao. **Size:** S. **Migration:** không.
**Trạng thái:** guide, chưa làm. Chỉ là tài liệu. Không sửa code, không viết test đỏ, không tạo `.done`.
**Depends:** user đã commit C1–C12 (xem `docs/tasks/TASK-080.commit-plan.md`). Lý do: C3 chạy `git add apps/server/test`, nên một test đỏ viết trước đó sẽ bị đưa vào commit.
**Mã nguồn mở có sẵn:** không áp dụng (thay đổi nội bộ về chính sách gọi tool).

## Vấn đề

- `apps/server/src/registry/invoke.ts:178`: `autonomy` chỉ được tính khi `input.source !== "agent"`. Với nguồn `agent`, `autonomy` luôn `undefined`, nên nhánh này không bao giờ đọc `getAutomationPaused`. Vì vậy sửa ở `invoke.ts:178` không đổi được kết quả cho `agent`. Đây không phải điểm quyết định.
- Điểm quyết định là `apps/server/src/registry/policy.ts:124`, trong `shouldCreatePending`: `if (input.source === "agent") return false;`. Dòng này chạy sau kiểm tra grant (`policy.ts:123`, `Object.hasOwn(TOOL_GRANTS, name)`), nên một tool có grant như `publish_project` đi qua đây và trả `false`, tức là chạy luôn.
- Kiểm tra pause ở `invoke.ts:157` chỉ áp cho scope sự kiện, không áp cho cuộc gọi thường.
- Hệ quả: khi automation đang pause, `publish_project` gọi từ nguồn `agent` không bị chuyển sang chờ duyệt.
- Nguồn `agent` lấy từ header `x-vg-tool-source: agent` (`apps/server/src/api/registry.ts:25–26`). MCP chỉ gửi header khi có `VG_TOOL_SOURCE` hoặc `access.toolSource` (`apps/mcp/src/apiClient.ts:396–398`).

## Quyết định (advisor, 2026-11-21)

1. Pause phải áp cho cuộc gọi nguồn `agent`. Kết quả mong đợi: `pending` (chờ user duyệt), không phải từ chối.
2. Grant publish không chặn nguồn `agent`. Cơ sở: `docs/cursor/TASK-069.md:101` ("no autonomy grant check" cho `agent`). Task này không đổi điểm đó. Đảo lại nếu user nói grant phải ràng buộc cả agent.
3. Đảo lại thành "đã đóng, theo thiết kế": nếu có tài liệu hoặc test nói pause không áp cho `agent`.
4. Đảo lại thành "lỗi": nếu có cách bỏ qua kiểm tra vai trò cho `agent`, hoặc có key không có quyền vẫn publish được.

## Phạm vi

- Khi automation đang pause và nguồn là `agent`: mọi tool có rủi ro `confirm` chuyển sang `pending`.
- Tool rủi ro `read` không đổi: vẫn chạy.
- Nguồn không phải `agent` không đổi.
- Thay đổi chỉ ảnh hưởng tool có grant (ví dụ `publish_project`). Tool không có grant và có rủi ro `confirm` đã chuyển `pending` ở `policy.ts:123` trước khi tới dòng 124, nên không đổi.
- `hardBlockMessage` và `forcesUserPending` vẫn áp cho mọi nguồn, không đổi.

## Việc (chỉ làm sau khi điều kiện bắt đầu được đáp ứng)

1. Viết test đỏ trước, hai ca:
   - Pin A: automation paused + `source: "agent"` + `publish_project` → `kind: "pending"`.
   - Pin B: automation không pause + `source: "agent"` + `publish_project` → vẫn chạy, không `pending`. Pin này bảo vệ Quyết định 2: grant không ràng buộc nguồn `agent`, và khi không pause thì hành vi không đổi.
   File gần nhất đã có setup pause là `apps/server/test/registry.test.ts` (pause qua `setAutomationPaused` ở dòng 323, nhánh sự kiện). Chạy, thấy đỏ, ghi lý do đỏ cụ thể (không chỉ ghi "fail").
2. Sửa `policy.ts:124` (không sửa `invoke.ts:178`):
   - Thêm trường `paused: boolean` vào input của `shouldCreatePending`. Trước khi sửa, grep mọi chỗ gọi `shouldCreatePending`. Nếu có chỗ gọi khác ngoài `invoke.ts`, đặt `paused` là tùy chọn với mặc định `false`.
   - Trước `if (input.source === "agent") return false;`, thêm: nếu `paused` và `risk === "confirm"` và nguồn là `agent` thì trả `true`.
   - Trong `invoke.ts` (vị trí gọi `shouldCreatePending`, quanh dòng 180–188), truyền `paused: getAutomationPaused(input.ctx.sqlite)`.
   - Giữ nguyên `hardBlockMessage` và `forcesUserPending`.
3. Mutant: bỏ nhánh `paused` ở `policy.ts` → Pin A đỏ, Pin B vẫn xanh. Khôi phục, so khớp từng byte.
4. Chạy `tsc --noEmit` trong `apps/server` và các suite liên quan: `registry`, `autonomy`, `autonomyGates`, `agentStagesApi`.
5. Kiểm tra `docs/ARCHITECTURE.md` §5. Nếu có câu nói pause không áp cho `agent`, sửa câu đó. Nếu không, không đổi.

## Ràng buộc

- Không commit, không push, không tạo `.done`.
- Không khởi động app.
- Không sửa `apps/server/test/storageProvider.test.ts` hay `.gitignore`.
- Không chạm `data/`, `data-dev/`, `docs/proposals/`.

## Tiêu chí xong

- Pin A và Pin B xanh sau khi sửa; Pin A đỏ với mutant.
- `tsc` xanh; các suite liên quan xanh.
- Báo cáo ghi rõ giới hạn còn lại và các quyết định đã áp dụng.
