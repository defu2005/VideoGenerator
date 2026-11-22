# Nhánh `product` và nhánh `dev`

Từ 2026-11-17 dự án có hai nhánh. Mọi agent (Claude, Codex, Cursor, Sonnet, Hermes) và người dùng đọc trang này trước khi chạy app hoặc sửa code.

| | `product` | `dev` |
|---|---|---|
| Mục đích | Vận hành thật: tạo video, đăng bài, autopilot, Telegram | Phát triển, thử tính năng mới |
| Thư mục | `C:\Users\defu\Documents\videoGenerator-product` (git worktree) | `C:\Users\defu\Documents\videoGenerator` (checkout chính) |
| Code | Chỉ commit đã review, đi tới bằng fast-forward từ `dev` | Code đang làm, có thể chưa commit |
| Dữ liệu | `videoGenerator\data\` (DB thật, file dự án, khóa trong `data/secrets`) | `data-dev\` (sandbox, ban đầu rỗng) |
| Cách chạy | Bản build (`node apps/server/dist/index.js` + `vite preview`) | `npm run dev` (tsx watch + Vite dev) |
| Cổng | API `3100`, web `http://localhost:5100` | API `3001`, web `5173` / `5180` |
| Ai sửa | Không ai sửa tay. Chỉ `promote.ps1` | Agent code theo `docs/cursor/README.md` |

## Vì sao tách

- DB lưu đường dẫn tuyệt đối tới `data\projects\...`, nên dữ liệu thật ở yên trong `videoGenerator\data` và chỉ bản product dùng nó.
- Server tự chạy migration khi khởi động. Nếu dev chạy trên DB thật, một migration đang làm dở sẽ vào thẳng DB thật. Vì vậy dev đọc `.env.dev` (`DATA_DIR=./data-dev`).
- Hai server cùng dùng một DB sẽ chạy worker, autopilot, lịch đăng và bot Telegram hai lần.

## Vận hành bản product (người dùng và agent vận hành)

Chạy trong thư mục product, bằng PowerShell:

```powershell
cd C:\Users\defu\Documents\videoGenerator-product
powershell -File deploy/product/start.ps1     # chạy API 3100 + web 5100, chờ /api/health
powershell -File deploy/product/stop.ps1      # dừng cả hai và tiến trình con (ffmpeg...)
```

- Mở `http://localhost:5100` và đăng nhập như thường.
- Log nằm trong `.product\api.log`, `.product\api.err.log`, `.product\web.log`.
- `start.ps1` từ chối chạy nếu thư mục không ở nhánh `product`, nếu chưa build, hoặc nếu cổng đã bị chiếm.
- Tùy chọn: `-ApiPort`, `-WebPort`, `-NoWorker` (không chạy hàng việc nền, dùng khi chỉ xem), `-DataDir` (chạy thử trên bản sao DB).
- Lần đầu chuyển sang product: dừng mọi `npm run dev` còn chạy trên `data\` thật (khởi động trước 2026-11-17), rồi mới `start.ps1`. Không bao giờ để dev và product cùng chạy trên `data\`.

### Kết nối agent và MCP với product

- MCP `video-agent` đọc khóa nội bộ trong `data\secrets\local-services.key` của checkout chính. Bản product dùng cùng `data\`, nên khóa khớp.
- Đặt `VG_API_URL=http://127.0.0.1:3100` cho MCP khi điều khiển product. Không đặt thì MCP gọi `3001`, tức bản dev.
- Đường dẫn OAuth callback của nền tảng theo cổng API: product là `http://127.0.0.1:3100/api/oauth/<nền tảng>/callback`. Khi nối thêm tài khoản Facebook, Instagram hoặc YouTube mới, thêm URI này vào ứng dụng của nền tảng. Tài khoản đã nối không cần làm lại.

## Đưa tính năng từ dev lên product

Chỉ làm sau khi tính năng đã review xong (report `.done`, Claude review đạt) và đã commit trên `dev`.

1. Trên `dev`: chạy đủ bộ test (`npm test`), `npm run typecheck`, `npm run build`. Tất cả đạt.
2. Kiểm tra docs của tính năng (mục "Quy tắc docs" bên dưới).
3. Commit trên `dev`.
4. Trong thư mục product:

   ```powershell
   powershell -File deploy/product/promote.ps1            # mặc định -Ref dev
   ```

   Script làm theo thứ tự:
   1. fast-forward `product` tới `dev` (không merge, không sửa tay);
   2. sao lưu DB online vào `C:\Users\defu\Documents\videoGenerator-backups\app-<thời gian>.db` và chạy `quick_check`;
   3. build;
   4. dừng rồi chạy lại product. Migration mới chạy lúc khởi động này.

   Lỗi ở bước nào thì dừng ở đó. Product cũ vẫn chạy nếu build lỗi.
5. Thêm một dòng vào `docs/user-guide/nhat-ky-thay-doi.md` nếu tính năng chưa có dòng nào.

### Quay lại bản trước

```powershell
cd C:\Users\defu\Documents\videoGenerator-product
powershell -File deploy/product/stop.ps1
git reset --hard <commit trước, promote.ps1 có in ra>
npm run build
```

- Nếu bản mới đã chạy migration, code cũ vẫn chạy được khi migration chỉ thêm bảng hoặc cột (quy tắc migration bên dưới).
- Nếu không chạy được: dừng product, chép file sao lưu thành `data\app.db` (xóa `app.db-wal`, `app.db-shm` cũ), rồi `start.ps1`.

## CI (kiểm tra tự động trên GitHub)

- File `.github/workflows/ci.yml`. Chạy khi push lên `dev`, `master`, `product`, khi mở pull request, hoặc chạy tay. Không dùng secret, quyền chỉ đọc (`contents: read`), không deploy gì.
- Job `test` (Linux, Node 22 như `deploy/docker/Dockerfile`): `npm ci`, thêm file native Linux của Rollup (bước "Add Linux Rollup native binary", vì `package-lock.json` ghi trên Windows thiếu entry này), rồi `npm run typecheck`, `npm test`, `npm run build`.
- Job `docker`: chỉ build `deploy/docker/Dockerfile`, không push.
- CI chưa từng chạy cho đến khi người dùng push. Lần chạy đầu sẽ chạy mọi test chưa từng chạy trên Linux, nên có thể đỏ. Lần đó là xác nhận thật đầu tiên, và không chứng minh gì cho Windows.
- Không có CD tự động. Cả hai đường đưa lên máy thật đều thủ công: `deploy/product/promote.ps1` (bản product trên Windows, chạy migration trên DB thật) và `deploy/install.sh` (Docker trên máy đích). Bước 1 của "Đưa tính năng từ dev lên product" (test, typecheck, build đạt) có thể được đáp ứng bằng một lần CI xanh trên đúng commit đó.
- Lockfile đúng nên được sinh lại trên Linux để không cần bước thêm rollup. Việc này cần cài và chạy test, nên là quyết định của người dùng.

## Dev

- `npm run dev` trong checkout chính dùng `data-dev\`. Lần đầu tạo tài khoản: `npm run reset-password`.
- Muốn dữ liệu thật để thử? Không chép `data\secrets`. Chạy product với `-DataDir` trỏ vào một bản sao DB và `-NoWorker`, hoặc tạo dự án thử trong dev.
- Không bao giờ đặt `DATA_DIR` của dev về `data\` thật.

## Quy tắc migration (để product luôn quay lại được)

- Không sửa migration đã có trong `apps/server/drizzle/meta/_journal.json`. Sai thì thêm migration mới.
- Chỉ thêm: bảng mới, cột mới cho phép NULL hoặc có giá trị mặc định. Đổi tên, xóa cột hoặc đổi kiểu cần một guide riêng, ghi rõ cách quay lại, và Claude duyệt trước khi promote.

## Quy tắc docs (bắt buộc ở cả hai nhánh)

Mọi tính năng, ở `dev` hay `product`, chỉ được coi là xong khi có đủ docs để **người dùng** và **agent** biết nó có và vận hành được:

| Cho ai | Phải có |
|---|---|
| Người dùng | Mục trong `docs/user-guide/*.md` (tiếng Việt): dùng ở đâu, làm thế nào, giới hạn, lỗi thường gặp. Mục `featureMap` trong `packages/shared/src/features/featureMap.ts`. Một dòng trong `docs/user-guide/nhat-ky-thay-doi.md` |
| Agent vận hành | Tool mới có mô tả rõ (tham số, rủi ro) trong registry. Việc mới được nêu trong skill ở `.agents/skills/*` (thêm vào skill có sẵn, hoặc skill mới và một dòng trong bảng của `video-van-hanh-app`) |
| Agent phát triển | `docs/ARCHITECTURE.md` khi đổi luồng hoặc dữ liệu. Report `docs/tasks/TASK-*.report.md` |
| Vận hành máy | Biến môi trường, cổng, script mới: ghi vào trang này hoặc `deploy/README.md` |

- Tính năng thiếu docs thì không promote lên `product`.
- Thay đổi chỉ ở hạ tầng hoặc chỉ ở test không cần mục user guide, nhưng vẫn cần dòng trong trang này hoặc `deploy/README.md` nếu đổi cách chạy.
