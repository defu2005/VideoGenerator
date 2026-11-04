# Tài liệu kết nối máy suy luận Ollama

Tài liệu này mô tả cách máy Windows gửi yêu cầu HTTP tới model `llama3.2:1b` đang chạy trên Cursor Cloud Agent VM. Model trả lời trực tiếp qua Ollama. Các câu hỏi sau không đi qua Cursor Agent.

Kiểm tra dịch vụ lần cuối: 11:58 sáng ngày 4 tháng 11 năm 2026 (Asia/Bangkok). Ollama, proxy và tunnel đều đang chạy. `POST /api/generate` trên URL công khai không token trả 401, có token trả 200. Máy Windows kết nối được cùng URL đó khi tunnel còn sống.

## 0. Lần sau vào cloud, không cần agent

Agent chỉ cần cho lần cài đầu. Các câu hỏi sau gửi thẳng tới Ollama. Khi VM đã mở, tự chạy một lệnh tại gốc repo:

```bash
bash artifacts/start-services.sh
```

Lệnh này bật `ollama serve` nếu cổng 11434 tắt, bật lại proxy cổng 11435, tạo tunnel mới và in URL. Token cũ được giữ nếu `.secrets/token` còn. Trên Windows chỉ cần đổi `OLLAMA_BASE_URL` theo URL vừa in, rồi gọi model từ máy local. Không gửi prompt cho Cursor Agent.

Tắt dịch vụ, giữ file model:

```bash
bash artifacts/stop-services.sh
```

Máy Windows không bật được VM khi cloud đang tắt. Phải vào VM trước, rồi chạy script. VM ngủ hoặc bị thay thì endpoint tắt cho đến lúc đó.

Nếu máy mới và chưa có `ollama` hoặc `cloudflared`:

```bash
sudo apt-get update
sudo apt-get install -y zstd curl ca-certificates
curl -fsSL https://ollama.com/install.sh | sh
curl -fsSL -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo install -m 755 /tmp/cloudflared /usr/local/bin/cloudflared
bash artifacts/start-services.sh
```

Model nên dùng trên VM này vẫn là `llama3.2:1b`. Bản đang nạp chiếm khoảng 2,0 GB RAM. Còn khoảng 2,6 GiB available và không có swap, nên không chuyển sang model 3B hoặc lớn hơn.

## 1. Sơ đồ

```text
Windows (client.py / client.ps1 / curl)
        |
        |  HTTPS  POST /api/generate
        |  Header: Authorization: Bearer <token>
        v
https://<tên>.trycloudflare.com          Cloudflare quick tunnel
        |
        v
127.0.0.1:11435   scripts/inference_proxy.py     chỉ trên VM
        |         kiểm tra token, chỉ cho một vài đường dẫn
        v
127.0.0.1:11434   ollama serve                   chỉ trên VM
        |
        v
/workspace/.ollama/models/llama3.2:1b    khoảng 1,3 GB
```

Cổng 11434 và 11435 gắn `127.0.0.1`. Chúng không mở ra internet. Đường vào duy nhất từ Windows là hostname HTTPS của tunnel, và proxy từ chối mọi request không có token đúng.

## 2. Địa chỉ đang dùng trong phiên này

Base URL lúc viết tài liệu:

```text
https://proc-increase-awarded-entertaining.trycloudflare.com
```

URL này **không cố định**. Mỗi lần `artifacts/start-services.sh` chạy lại, Cloudflare cấp hostname mới. Khi URL hết hiệu lực, Windows nhận lỗi phân giải tên hoặc lỗi kết nối, không phải lỗi model.

Token không ghi trong tài liệu này, không ghi trong git, và không in ra log. Token nằm ở hai file trên VM, quyền chỉ chủ file đọc được:

| File | Nội dung |
| --- | --- |
| `.secrets/token` | Chuỗi token thô |
| `.secrets/inference.env` | `OLLAMA_BASE_URL=...` và `OLLAMA_TOKEN=...` |

Mở `.secrets/inference.env` trong Cursor, copy hai giá trị sang Windows. Không commit file đó, không dán token vào ảnh chụp màn hình, issue, hay pull request.

## 3. Biến môi trường phía Windows

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | Có | Gốc HTTPS, không có đường dẫn cuối. Ví dụ `https://proc-increase-awarded-entertaining.trycloudflare.com` |
| `OLLAMA_TOKEN` | Có | Bearer token copy từ `.secrets/inference.env` |
| `OLLAMA_MODEL` | Không | Mặc định `llama3.2:1b` |
| `OLLAMA_TIMEOUT` | Không | Giây chờ tối đa. Mặc định `180` |

Chỉ cho phiên PowerShell hiện tại:

```powershell
$env:OLLAMA_BASE_URL = "https://proc-increase-awarded-entertaining.trycloudflare.com"
$env:OLLAMA_TOKEN = "<dán từ .secrets/inference.env>"
$env:OLLAMA_MODEL = "llama3.2:1b"
$env:OLLAMA_TIMEOUT = "180"
```

Giữ cho các cửa sổ PowerShell mới của cùng người dùng Windows:

```powershell
[System.Environment]::SetEnvironmentVariable("OLLAMA_BASE_URL", "https://proc-increase-awarded-entertaining.trycloudflare.com", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_TOKEN", "<dán từ .secrets/inference.env>", "User")
```

Đóng rồi mở lại terminal sau khi đặt biến mức User. Khi tunnel đổi hostname, cập nhật lại `OLLAMA_BASE_URL`. Token chỉ đổi khi file `.secrets/token` bị xóa rồi `start-services.sh` tạo token mới.

## 4. Python

Cần Python 3 sẵn trên Windows. Không cần `pip install`.

Từ thư mục repo:

```powershell
python .\artifacts\client.py "Xin chào, hãy giới thiệu bản thân."
```

Client đọc mọi đối số sau tên file thành một prompt. Thiếu prompt thì thoát mã 2. Thiếu biến môi trường thì thoát mã 2. HTTP lỗi, lỗi DNS, hoặc hết giờ thì thoát mã 1 và in lý do ra stderr. Thành công thì in trường `response` ra stdout.

Thử nhanh không cần file script:

```powershell
python -c "import os,json,urllib.request; req=urllib.request.Request(os.environ['OLLAMA_BASE_URL'].rstrip('/')+'/api/generate', data=json.dumps({'model':'llama3.2:1b','prompt':'Xin chào','stream':False}).encode(), headers={'Authorization':'Bearer '+os.environ['OLLAMA_TOKEN'],'Content-Type':'application/json'}); print(json.load(urllib.request.urlopen(req, timeout=180))['response'])"
```

## 5. PowerShell

```powershell
powershell -File .\artifacts\client.ps1 "Xin chào, hãy giới thiệu bản thân."
```

Script dùng `Invoke-RestMethod`. Lỗi mạng in ra và thoát mã 1. Nếu JSON trả về không có `response`, script in cả object.

## 6. curl trên Windows

`curl.exe` có sẵn trên Windows 10/11. Dùng `curl.exe` để tránh alias `curl` của PowerShell.

```powershell
curl.exe -sS --max-time 180 -X POST "$env:OLLAMA_BASE_URL/api/generate" `
  -H "Authorization: Bearer $env:OLLAMA_TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"llama3.2:1b\",\"prompt\":\"Xin chào, hãy giới thiệu bản thân.\",\"stream\":false}"
```

## 7. Hợp đồng HTTP

### `POST /api/generate`

Body:

```json
{
  "model": "llama3.2:1b",
  "prompt": "Xin chào, hãy giới thiệu bản thân.",
  "stream": false
}
```

Header:

```http
Authorization: Bearer <OLLAMA_TOKEN>
Content-Type: application/json
```

`stream` phải là `false` với hai client trong repo. Ollama khi `stream: false` trả một JSON. Các trường hay dùng:

| Trường | Ý nghĩa |
| --- | --- |
| `response` | Văn bản model sinh ra |
| `model` | Tên model đã chạy |
| `done` | `true` khi sinh xong |
| `eval_count` | Số token sinh |
| `eval_duration` | Thời gian sinh, đơn vị nano giây |
| `total_duration` | Tổng thời gian xử lý, nano giây |
| `load_duration` | Thời gian nạp model, nano giây. Lần đầu khoảng 1,8 giây, các lần sau gần 0 |
| `prompt_eval_count` | Số token của prompt |

Token mỗi giây xấp xỉ `eval_count / (eval_duration / 1e9)`. Trên VM này, sau khi model đã nằm trong RAM, mức đo được là khoảng 38–46 token/s.

Có thể thêm `options`, ví dụ `{"temperature": 0.2, "num_predict": 80}`. `num_predict` giới hạn số token sinh.

### `POST /api/chat`

Cùng header và cùng token. Dùng khi muốn lịch sử hội thoại:

```json
{
  "model": "llama3.2:1b",
  "stream": false,
  "messages": [
    {"role": "user", "content": "Xin chào, hãy giới thiệu bản thân."}
  ]
}
```

Văn bản nằm ở `message.content`. Hai file client chỉ gọi `/api/generate`. Muốn chat thì gửi HTTP trực tiếp như trên.

### `GET /api/tags`

Liệt kê model Ollama đang có. Vẫn cần bearer token. Dùng để kiểm tra sống/chết mà không sinh token.

```powershell
curl.exe -sS --max-time 30 "$env:OLLAMA_BASE_URL/api/tags" `
  -H "Authorization: Bearer $env:OLLAMA_TOKEN"
```

Kỳ vọng thấy `llama3.2:1b`.

### Đường dẫn khác

Proxy chỉ chuyển tiếp:

- `/api/generate`
- `/api/chat`
- `/api/tags`
- `/api/ps`
- `/api/version`

Mọi đường dẫn khác, kể cả đúng token, trả **404**. Không có giao diện web.

## 8. Mã lỗi

| Hiện tượng | Nguyên nhân thường gặp | Việc làm |
| --- | --- | --- |
| HTTP 401 `{"error":"unauthorized"}` | Thiếu header, sai chữ `Bearer`, hoặc token lệch với `.secrets/token` | Copy lại cả dòng `OLLAMA_TOKEN`, không thêm khoảng trắng hay dấu ngoặc |
| HTTP 404 `{"error":"not found"}` | Sai đường dẫn | Chỉ dùng các path ở mục 7 |
| HTTP 413 | Body lớn hơn 8 MB | Rút prompt |
| HTTP 502 `upstream unavailable` | Ollama tắt trong khi proxy còn | Trên VM chạy `bash artifacts/start-services.sh` |
| HTTP 504 | Ollama không trả lời trong 300 giây | Xem RAM. Model 1B thường xong trong vài giây |
| Connection error / hết giờ phía client | Tunnel chết, URL cũ, hoặc VM ngủ | Chạy lại start script, lấy URL mới trong `.secrets/inference.env` |
| `Name or service not known` | `OLLAMA_BASE_URL` sai hoặc hostname quick tunnel đã bị thu hồi | Đổi URL, giữ nguyên token nếu file `.secrets/token` chưa bị xóa |

Client Python coi hết giờ là `TimeoutError` và thoát mã 1.

## 9. Kiểm tra từ Windows theo thứ tự

1. VM còn mở trong Cursor. Quick tunnel chỉ sống khi process `cloudflared` còn chạy.
2. Đặt `OLLAMA_BASE_URL` và `OLLAMA_TOKEN`.
3. `GET /api/tags` với token. Có `llama3.2:1b` là đường mạng và quyền đã đúng.
4. `GET` cùng URL **không** gửi token phải ra 401. Nếu ra 200 thì endpoint đang hở. Không dùng trạng thái đó.
5. `POST /api/generate` với prompt ngắn. Lần đầu sau khi model bị đẩy khỏi RAM có thể mất khoảng 4 giây. Các lần sau thường 0,4–2 giây với câu ngắn.

Ví dụ câu đã chạy thành công trên chính URL công khai, từ client Python của repo: `Xin chào, hãy giới thiệu bản thân trong một câu.`

## 10. Bật lại sau khi VM tạm dừng

Trên VM, tại gốc repo:

```bash
bash artifacts/start-services.sh
```

Script làm năm việc:

1. Tạo `.secrets/token` chỉ khi file chưa có hoặc rỗng.
2. Chạy `ollama serve` nếu `127.0.0.1:11434` không trả lời. Biến `OLLAMA_HOST=127.0.0.1:11434`, `OLLAMA_MODELS=/workspace/.ollama/models`, `OLLAMA_NUM_PARALLEL=1`.
3. `ollama pull llama3.2:1b` chỉ khi `ollama list` chưa có model đó và còn ít nhất khoảng 3 GB đĩa.
4. Khởi động lại proxy cổng 11435 và Cloudflare quick tunnel.
5. Ghi đè `.secrets/inference.env` bằng URL mới và token hiện có. In URL ra terminal. Không in token.

Tắt process, giữ file model:

```bash
bash artifacts/stop-services.sh
```

Sau mỗi lần start, cập nhật `OLLAMA_BASE_URL` trên Windows từ file env mới.

Đổi token: xóa `.secrets/token`, chạy lại start script, copy token mới. URL cũng đổi theo.

## 11. Cài lại công cụ nếu VM là máy mới

`start-services.sh` không cài Ollama hay cloudflared. Máy mới clone từ git chỉ có script. Trên Ubuntu của Cloud Agent:

```bash
sudo apt-get update
sudo apt-get install -y zstd curl ca-certificates
curl -fsSL https://ollama.com/install.sh | sh
curl -fsSL -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /tmp/cloudflared
sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
bash artifacts/start-services.sh
```

Bản đã cài trên VM này: Ollama 0.40.14, cloudflared 2026.10.7. systemd không phải PID 1 nên service systemd của Ollama không tự chạy. Script start dùng `ollama serve` trực tiếp.

## 12. Máy đang chạy model

| Hạng mục | Giá trị lúc 11:29 Asia/Bangkok |
| --- | --- |
| OS | Ubuntu 24.04.5 LTS, kernel 6.12.94+, x86_64, KVM |
| CPU | 4 nhân Intel Xeon ảo |
| RAM | 15 GiB tổng, khoảng 2,6 GiB available khi model đã nạp, không swap |
| Balloon | Hypervisor đang giữ khoảng 10 GiB |
| Đĩa | 254 GB, còn khoảng 243 GB. Model chiếm 1,3 GB trong `/workspace/.ollama` |
| GPU | Không có |
| Tốc độ | Khoảng 38–46 token/s sau khi đã nạp. Bảng đo: `artifacts/inference-benchmark.md` |

Một model 1B vừa với phần RAM còn lại. Không tải model lớn hơn khi `MemAvailable` chỉ còn khoảng 2,6 GiB.

## 13. Cái gì còn, cái gì mất

| Dữ liệu | Trong git | Sau khi VM bị thay bằng máy mới |
| --- | --- | --- |
| `artifacts/`, `scripts/inference_proxy.py` | Có | Có, vì checkout lại repo |
| `.secrets/` (token, URL, log) | Không | Không. Start script tạo token mới nếu thiếu file |
| `.ollama/` (~1,3 GB) | Không | Không trên máy tạo mới từ git. Resume ngắn trên cùng ổ đĩa thường còn file, nhưng không được coi là kho bền |
| Process Ollama, proxy, hostname tunnel | Không | Không. VM tắt thì endpoint tắt |
| Binary `/usr/local` (Ollama, cloudflared) | Không | Không, trừ khi môi trường được snapshot và agent sau boot từ snapshot đó |

Không có cơ chế nào giữ endpoint online khi Cloud Agent VM bị suspend. Quick tunnel cũng không có SLA. Cloudflare ghi rõ tunnel không tài khoản có thể bị xem xét và không cam kết thời gian hoạt động.

## 14. Bảo mật và chi phí

- Không publish cổng 11434. Kiểm tra bằng cách chỉ gọi được Ollama từ chính VM tại `127.0.0.1:11434`, còn từ Windows thì chỉ qua HTTPS của tunnel.
- Token là khóa duy nhất. Ai có token dùng được CPU của VM.
- Log proxy chỉ ghi method và path `/api/...`, không ghi header Authorization và không ghi body.
- Cursor tính phí thời gian VM còn chạy. Ollama không tính phí theo token. Quick tunnel không cần tài khoản Cloudflare và cũng không phải gói trả phí cố định. Tunnel gắn zone Cloudflare riêng thì ổn định hơn và có thể phát sinh phí gói Cloudflare.
- Request đồng thời được xếp hàng (`OLLAMA_NUM_PARALLEL=1`), không nhân bản model trong RAM.

## 15. File liên quan

| File | Vai trò |
| --- | --- |
| `artifacts/KET-NOI.md` | Tài liệu này |
| `artifacts/README.md` | Mục lục ngắn và lệnh vận hành |
| `artifacts/client.py` | Client Windows / mọi máy có Python 3 |
| `artifacts/client.ps1` | Client PowerShell |
| `artifacts/start-services.sh` | Bật Ollama, proxy, tunnel |
| `artifacts/stop-services.sh` | Tắt ba process, giữ model |
| `artifacts/system-info.txt` | Thông số máy lúc khảo sát ban đầu, trước khi nạp model |
| `artifacts/inference-benchmark.md` | Năm phép đo tiếng Việt và phép đo song song |
| `scripts/inference_proxy.py` | Proxy bắt token |
