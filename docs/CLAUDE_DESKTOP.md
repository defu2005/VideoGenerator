# Kết nối Claude Desktop với Video Agent

MCP server dùng REST API hiện có của Video Agent. Nó không truy cập SQLite hoặc hệ thống tệp của project; thao tác duyệt/duyệt gate vẫn thực hiện trong giao diện web.

## Build

Từ thư mục gốc repository, chạy:

```powershell
npm run build
```

Khởi động Video Agent bằng `npm run dev` trước khi gọi các công cụ MCP.

## Cấu hình Claude Desktop trên Windows

Mở `%APPDATA%\Claude\claude_desktop_config.json` và thêm server sau. Thay `C:\\path\\to\\videoGenerator` bằng đường dẫn tuyệt đối đến repository trên máy của bạn:

```json
{
  "mcpServers": {
    "video-agent": {
      "command": "node",
      "args": ["C:\\path\\to\\videoGenerator\\apps\\mcp\\dist\\index.js"],
      "env": {
        "VG_API_URL": "http://127.0.0.1:3001"
      }
    }
  }
}
```

Lưu file rồi khởi động lại Claude Desktop. Nếu API chưa chạy, công cụ sẽ báo URL và nhắc chạy `npm run dev`.

## Ví dụ

- “Liệt kê project của tôi”
- “Viết research rồi script cho project `<tên hoặc id>`”
- “Chạy tiếp pipeline cho project `<id>`”

Các prompt `write_research`, `write_script`, `write_story` hướng dẫn Claude lấy brief và schema đúng từ API trước khi lưu.

## Tự động hóa bằng Claude Code CLI

Cài Claude Code CLI và đăng nhập một lần bằng lệnh `claude`. Trong `.env` ở thư mục gốc, bật:

```dotenv
CLAUDE_CLI_ENABLED=true
LLM_DEFAULT_PROVIDER=claude-cli
```

Nếu CLI không nằm trên `PATH`, đặt `CLAUDE_CLI_PATH` thành đường dẫn executable. CLI chạy ở thư mục tạm rỗng, không có quyền truy cập công cụ; prompt được gửi qua stdin. Chế độ này dành cho mục đích sử dụng cá nhân trên máy của bạn. Hãy kiểm tra điều khoản của Anthropic trước khi cung cấp cho người dùng khác.

Có thể đặt `CLAUDE_CLI_MODEL` để chọn model mặc định; lựa chọn model theo project hoặc `LLM_DEFAULT_MODEL` vẫn được ưu tiên.
