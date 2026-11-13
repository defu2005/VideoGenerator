# TASK-067c

## Đã làm

Helper thuần trong `packages/shared/src/compose`: `lang/` (`getLangPack`, vi/en/`DIGITS_ONLY`), `numbers.ts` (`parseNumbers`, `comparableGroups`, `startsWithOrdinal`, `findContrastWord`), `variety.ts` (`checkVariety`, `enforceVariety`). Thêm export trong `compose/index.ts` và một đoạn trong `docs/compose/README.md`. Không có giao diện nên không sửa hướng dẫn người dùng.

## Kiểm tra

`npm run typecheck` đạt, khoảng 00:43 giờ Bangkok (UTC+7) ngày 11/11/2026. `npx vitest run packages/shared/src/compose`: 8 file, 62 test đạt. `npm test`: shared 504 đạt, mcp 19 đạt, web 180 đạt. Server lần chạy cả workspace: 24 test đỏ, hầu hết hết 30 giây vì máy bận. Chạy lại riêng: `worker`, `analytics`, `assistant` đạt.

Còn đỏ, ngoài file của task này:

- `autonomy.test.ts`: tool `propose_knowledge_change` chưa có trong `TOOL_GRANTS` (việc 073a).
- `autonomyGates.test.ts`: cổng đăng không còn lý do `quota`.

## Khác hướng dẫn

- Số viết bằng chữ ("hai mươi", "twenty") bỏ qua, đúng phạm vi.
- Không copy mã. Comment dẫn compromise (MIT) cho đuôi en k/m/bn, và danh sách bậc tiếng Việt kiểu vietnamese-number (MIT). Không thêm dependency.
- `npm test` server không xanh vì hai test trên, không phải do helper compose.
