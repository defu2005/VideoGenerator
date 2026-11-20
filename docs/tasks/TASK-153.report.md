# TASK-153 — automation pause phải áp cho cuộc gọi nguồn `agent` (báo cáo)

Trạng thái: đã code, test và commit cục bộ trên `dev` theo quyết định advisor ngày 2026-11-21. **Chưa push, không có `.done`.** Không khởi động app, không chạy trình duyệt. Không chạm `apps/server/test/storageProvider.test.ts`, `.gitignore`, `data/`, `data-dev/`, `docs/proposals/`.

## Quyết định áp dụng (advisor, 2026-11-21, từ `docs/cursor/TASK-153.md`)

1. Pause áp cho cuộc gọi nguồn `agent`: tool `confirm` chuyển sang `pending`, không bị từ chối.
2. Grant publish không chặn nguồn `agent` (theo `docs/cursor/TASK-069.md:101`). Không đổi điểm này.
3. Tool `read` không đổi; nguồn không phải `agent` không đổi; `hardBlockMessage` và `forcesUserPending` không đổi. Đã kiểm: không có tài liệu hay test nào nói pause không áp cho `agent`. `apps/server/test/assistant.test.ts` dùng hàm pause nhiều lần, nhưng không lượt nào dùng nguồn `agent`; các dòng `docs` khớp đều là TASK-153 hoặc §5 đã sửa.

## Thay đổi

- `apps/server/src/registry/policy.ts` (dòng 112–126): thêm trường tùy chọn `paused?: boolean` (mặc định `false`) vào input của `shouldCreatePending`, và một dòng ngay trước `if (input.source === "agent") return false;` (dòng 127):
  `if (input.paused && risk === "confirm" && input.source === "agent") return true;`
  `loop.ts` (nguồn `assistant`) là chỗ gọi thứ hai, không truyền `paused`, nên hành vi của nó không đổi.
- `apps/server/src/registry/invoke.ts`: truyền `paused: getAutomationPaused(input.ctx.sqlite)` vào lời gọi `shouldCreatePending` (một dòng). Dòng 178 (`autonomy`) không đổi.
- `apps/server/test/registry.test.ts`: hai test mới ở cuối describe "tool registry", tách riêng để mỗi pin có kết quả độc lập:
  - Pin A: `TASK-153: a paused automation sends agent-sourced publish_project to pending`. Pause automation, gọi `POST /api/registry/invoke` với header `x-vg-tool-source: agent`, kỳ vọng 200 và có `pendingActionId`.
  - Pin B: `TASK-153: an unpaused automation does not make agent-sourced publish_project pending`. Không pause, cùng lời gọi, kỳ vọng 409 `PUBLISH_GATE`, không có `pendingActionId`, số dòng audit `publish_project`/`agent`/`pending` không tăng.
- `docs/ARCHITECTURE.md`: sửa năm đoạn bị lỗi thời, đều liên quan tới cách nhánh pause tương tác với nguồn `agent`. Bốn đoạn ở §5 và một hàng ở §15:
  - dòng 180: bullet `shouldCreatePending` đổi phạm vi thành dòng 104–132 và thêm nhánh pause;
  - dòng 186: bullet nguồn `agent` thêm ngoại lệ khi automation đang pause (chờ người dùng, không chạy trực tiếp);
  - dòng 190: bullet nhóm `null` thêm điều kiện "trừ khi automation đang pause";
  - §15, dòng 434: hàng bảng "Nguồn `agent` chạy mọi việc `confirm`" thêm ngoại lệ khi automation đang pause, và đổi phạm vi `policy.ts` thành 100–132;
  - dòng 198: đoạn kết thêm "và automation không đang pause".
  **Đây là chỗ phán đoán, vượt quá lệnh "nếu không, không đổi" trong `docs/cursor/TASK-153.md` bước 5.** Lý do: giữ nguyên các câu đó sẽ khiến tài liệu nói tool `confirm` có khóa chạy trực tiếp khi pause, điều đã sai sau TASK-153. Người dùng nên xem lại năm đoạn này.

## Test đỏ trước khi sửa

Lệnh: `npx vitest run test/registry.test.ts -t "TASK-153"` trong `apps/server`, khi `policy.ts` và `invoke.ts` chưa sửa. Lúc đó hai pin còn là một test gộp; test dừng ở Pin A nên Pin B chưa được chạy riêng trên mã cũ.

```
 FAIL  |parallel| test/registry.test.ts > tool registry > TASK-153: a paused automation sends agent-sourced publish_project to pending; unpaused it does not
AssertionError: expected 409 to be 200 // Object.is equality
 ❯ test/registry.test.ts:624:33
    623|       const paused = await publish();
    624|       expect(paused.statusCode).toBe(200);
Tests  1 failed | 17 skipped (18)
```

Lý do đỏ cụ thể: lượt agent khi automation đang pause **không** trả `pending`. Lượt đi thẳng tới `execute()` của `publish_project` và bị cổng đăng chặn: `{"error":{"code":"PUBLISH_GATE","message":"Chưa đăng được: thumbnail."}}` (409). Đây là đúng lỗi: lượt chạy thay vì chờ duyệt.

Ghi chú: lần viết test đầu dùng `kind` để kiểm tra pending và bị sai. Hình dạng đúng là `{ pendingActionId, summaryVi }`; đã sửa cả hai pin.

## Sau khi sửa

- Hai test tách riêng, `npx vitest run test/registry.test.ts -t "TASK-153"`: 2/2 xanh (log `scratchpad/153-green-split.log`).
- Pin A: có `pendingActionId` (200). Pin B: 409 `PUBLISH_GATE`, không `pendingActionId`, số dòng pending không tăng.

## Mutant (kiểm Pin A và Pin B độc lập)

- Mutant 1, bỏ hẳn dòng `paused` khỏi `policy.ts`: **Pin A đỏ** (`expected 409 to be 200`), **Pin B xanh**. Log: `scratchpad/153-mut1-no-branch.log` (cùng kết quả với `scratchpad/mut-paused.log`).
- Mutant 2, giữ dòng nhưng bỏ điều kiện `input.paused &&` (tool `confirm` agent không pause cũng thành pending): **Pin B đỏ** (`expected 200 to be 409`, lượt không pause bị đưa vào pending), **Pin A xanh**. Log: `scratchpad/153-mut2-no-paused-flag.log`.
- Cả hai lần đều khôi phục `policy.ts` từ bản sao đã lưu và kiểm bằng `cmp`: giống hệt bản đã sửa.

## Kiểm tra (sau mọi chỉnh sửa)

| Lệnh (trong `apps/server`) | Kết quả | Log |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | `scratchpad/153-tsc-final.log` |
| `test/registry.test.ts` | 19/19 passed, exit 0 | `scratchpad/153-registry-final.log` |
| `test/autonomy.test.ts` | 4/4 passed, exit 0 | `scratchpad/153-autonomy-final.log` |
| `test/autonomyGates.test.ts` | 13/13 passed, exit 0 | `scratchpad/153-autonomyGates-final.log` |
| `test/agentStagesApi.test.ts` | 19/19 passed, exit 0 | `scratchpad/153-agentStagesApi-final.log` |
| `test/assistant.test.ts` (thêm, vì dùng `setAutomationPaused`) | 15/15 passed, exit 0 | `scratchpad/153-assistant.log` |

Đường dẫn log đầy đủ nằm trong `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\`.

## Giới hạn còn lại

1. Pin B dùng một UUID tài khoản không tồn tại. Lượt không bị `pending`, nhưng bị `PUBLISH_GATE` (409) trước khi tới bước đăng. Pin B vì vậy chứng minh "không chờ duyệt" chứ không chứng minh "đăng thành công". Test không gọi mạng.
2. Chỉ kiểm `publish_project`. Các tool `confirm` khác có grant (ví dụ nhóm `null`, xem §5) không được chạy thử riêng; cùng nhánh code nên dự kiến cùng hành vi, nhưng chưa chứng minh.
3. Đã commit cục bộ trên `dev` theo quyết định advisor ngày 2026-11-21, chưa push. Commit chỉ gồm năm file đã nêu, không có `storageProvider.test.ts`.
4. Chưa chạy toàn bộ suite server; chỉ các suite trong bảng trên.
5. Đường tiếp cận header `x-vg-tool-source` (ai đặt được header đó) chưa đối chiếu với lớp xác thực; tài liệu §5 đã ghi điều này và không tự kết luận.

## Không làm (theo ràng buộc)

- Không `git push`. Không tạo `TASK-153.done`. Commit cục bộ trên `dev` là theo quyết định advisor ngày 2026-11-21 (xem đầu báo cáo), không phải theo lệnh trực tiếp của user.
- Không khởi động app. Không đổi `storageProvider.test.ts`, `.gitignore`.
