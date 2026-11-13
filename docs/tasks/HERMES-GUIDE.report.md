# HERMES-GUIDE — Kết nối Hermes Agent

Đã thêm mục **Kết nối Hermes Agent** ngay sau **Agent operator** trong `docs/user-guide/tro-ly-va-telegram.md`. Mẫu dùng `~/.hermes/config.yaml`, khóa `mcp_servers.video-agent`, và cấu hình sau.

```yaml
mcp_servers:
  video-agent:
    command: '/mnt/c/Program Files/nodejs/node.exe'
    args:
      - 'C:\Users\defu\Documents\videoGenerator\apps\mcp\dist\index.js'
    env:
      VG_API_URL: 'http://127.0.0.1:3001'
      VG_TOOL_SOURCE: 'operator'
      WSLENV: 'VG_API_URL/w:VG_TOOL_SOURCE/w'
```

## Nguồn chính thức

- Trang tài liệu của Nous Research. [Hermes Agent Docs](https://hermes-agent.nousresearch.com/docs)
- Mục cấu hình stdio, truyền `env` và lệnh kiểm tra. [MCP của Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)

## Thử kết nối

Từ Ubuntu 24.04 trong WSL, Python mở đúng `node.exe` và file MCP đã build như mẫu. Cổng 3001 đang bận, nên lượt thử dùng một API Windows riêng tại `http://127.0.0.1:51365`, SQLite trong thư mục tạm và provider giả lập. Giá trị `VG_API_URL` trong lượt thử trỏ đến cổng tạm này.

`initialize` trả về `video-agent-mcp` với giao thức `2024-11-05`. Sau `notifications/initialized`, `tools/list` trả 93 công cụ, gồm `list_projects` và `find_tools`. Danh sách không có `app_api`, xác nhận Node nhận cấu hình registry-only. `tools/call` với `list_projects` thành công trên API tạm. Đã dừng API tạm sau lượt thử. Không sửa cấu hình Hermes đang dùng. Lượt thử xác minh đường stdio và API bằng client JSON-RPC từ WSL. Phiên chat Hermes chưa được chạy với mẫu.

## Kiểm thử

| Lệnh | Kết quả |
|---|---|
| `npm test -w @vg/shared` | 329 qua, 8 lỗi trong `budget.test.ts`, `llm.test.ts`, `modelEval.test.ts` và `providerIntel.test.ts`. Các lỗi liên quan kỳ vọng về preset, ước tính ngân sách, catalog tác vụ và ánh xạ năng lực. |
| `npm test -w @vg/web` | 158 qua, 3 lỗi trong `ProjectDetailPage.test.tsx`, `AiSettingsPage.test.tsx` và `guideCoverage.test.ts`. |
| `npm test -w @vg/web -- src/features/help/guideCoverage.test.ts` | Chạy lại sau khi thêm mục Hermes. 4 qua, 1 lỗi tại dòng 86 vì danh sách tab hồ sơ thực tế có thêm `knowledge` so với danh sách test mong đợi. |

Các lỗi được ghi nhận trên worktree có TASK-057 đang chỉnh đồng thời. Phạm vi chỉnh sửa lần này chỉ gồm mục hướng dẫn và hai file bàn giao.
