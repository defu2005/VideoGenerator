# TASK-074c-4a — bộ ghi bản nháp `docs/proposals/` (báo cáo)

Trạng thái: chỉ có bộ ghi hẹp đã code và test. Chưa có gì trong production gọi `writeProposalDraft`. Chưa có đường chấp nhận yêu cầu (không mã nào đặt `accepted` trên `improvement_requests`), chưa có lời gọi LLM, chưa có migration. Chưa commit, chưa push, chưa có `.done`.

## Đã làm

- `apps/server/src/operator/proposalWriter.ts` (mới): `writeProposalDraft(rootDir, fileName, content)` trả `written` hoặc `refused` với lý do `bad_name | bad_root | unsafe_target | exists | bad_content`. Hằng `MAX_DRAFT_BYTES = 100_000`.
- `apps/server/test/proposalWriter.test.ts` (mới): 29 test (28 chạy, 1 bỏ qua). Mọi test dùng thư mục tạm qua `mkdtemp` và `realpathSync.native`, không chạm `docs/proposals/` thật.
- `writeGuard.ts` không đổi. Theo guide (dòng 65), bộ ghi này không mở rộng `writeGuard.ts`.

## Thiết kế

- Tên file phải khớp `^IMP-[1-9]\d{0,8}\.md$`. Regex này chặn `..`, dấu phân cách đường dẫn, đường dẫn tuyệt đối, `IMP-0.md`, số có 0 đứng đầu, số quá 9 chữ số, đuôi khác `.md`, chữ thường/hoa lẫn lộn `.MD`, khoảng trắng hoặc dấu chấm thừa, stream thay thế NTFS (`:ads`), byte null.
- Lớp kiểm thứ hai: `relative(root, target)` phải bằng đúng tên file, không tuyệt đối, không bắt đầu bằng `..`.
- Thư mục gốc: phải là đường dẫn tuyệt đối (không thì `bad_root`), sau đó được chuẩn hóa bằng `resolve`. `lstat` phải là thư mục và không phải symlink/junction. `realpathSync.native(root)` phải trùng với đường dẫn đã chuẩn hóa (so sánh không phân biệt hoa thường trên win32). Cách này bắt được junction ở tổ tiên, không chỉ thành phần cuối. Không tồn tại → `bad_root`, không tạo.
- Đích đã tồn tại: `lstat` trước. Symlink → `unsafe_target`. Mọi thứ khác → `exists`, giữ nguyên nội dung cũ.
- Ghi bằng cờ `wx` (không bao giờ ghi đè). `EEXIST` → `exists`. Lỗi khác được ném lại.
- Nội dung: chuỗi, không rỗng sau `trim`, tối đa 100 000 byte UTF-8.
- Nhãn "Bản nháp guide — cần Claude xem lại…" trong guide dòng 67 mô tả nhãn trên trang hiển thị, không phải nội dung file. Bộ ghi không ép nhãn này.

## Kết quả kiểm tra

- Red: chạy trước khi có module. Lỗi `Cannot find module '../src/operator/proposalWriter.js'` (đúng dự kiến).
- Vòng 1 (ban đầu): `proposalWriter.test.ts` 25 pass, 1 bỏ qua. Test bỏ qua là `refuses when the target name is already a symlink…`, vì môi trường này không tạo được symlink file (cần quyền). Đây là **chưa chạy**, không phải đã đạt.
- Vòng 2 (advisor: thư mục gốc tương đối, tổ tiên là junction, target là junction):
  - Red trước: `refuses a relative root…` và `refuses a root whose ancestor is a junction…` đỏ, lỗi `expected written to deeply equal refused`. Test `refuses a target that is a junction…` xanh ngay (đây là test phủ, không phải test đỏ).
  - Sửa: kiểm đường dẫn tuyệt đối và `realpathSync.native`. Xanh: 28 pass, 1 bỏ qua.
  - Mutation nhánh `unsafe_target` (trả `exists` thay vì `unsafe_target`): test junction target đỏ. Đã hoàn nguyên; xanh.
  - Mutation kiểm `isSymbolicLink` của thư mục gốc (vòng 1): test junction vẫn xanh, vì trên Windows `lstat` báo junction là không phải thư mục nên `!isDirectory()` đã chặn. Kiểm symlink là lớp dự phòng, không có test cô lập. Vẫn ghi nhận như vậy.
- `tsc --noEmit` trong `apps/server`: exit 0 (sau vòng 2).
- 074c-3 chạy cùng: `improvementOpenSource.test.ts` 14/14 xanh. Chạy chung hai file: 42 pass, 1 bỏ qua.
- Full suite **không chạy lại** ngay sau khi thêm bộ ghi (số 15:00 không có file này). Sau đó đã chạy full suite lần thứ hai, trong TASK-074c-4b-1: **281 file passed | 4 skipped (285); 2306 test passed | 9 skipped (2315); EXIT 0**. Tổng khớp khi cộng `proposalWriter.test.ts` vào lần 15:00; log không liệt kê theo file, nên việc file này nằm trong lần chạy là suy từ phép cộng. Log: `scratchpad/server-full-4b1.log`. Không có module nào import `proposalWriter.ts` ngoài test.

## Giới hạn đã biết

1. Không có caller. Bộ ghi không được gọi từ đâu, và không có đường chấp nhận yêu cầu để gọi nó.
2. Lớp symlink của thư mục gốc không được kiểm riêng trên Windows; xem mutation ở trên.
3. Symlink file chưa chạy trên máy này (bỏ qua, không tính là đạt).
4. Không khóa đồng thời: hai lần ghi cùng tên có thể cùng vượt `lstat`, nhưng `wx` đảm bảo chỉ một lần thành công, lần kia trả `exists`.
5. Không kiểm quyền ghi của hệ điều hành ngoài các lỗi được ném lại.

## Câu hỏi mở (cho 074c-4b)

- Đánh số `<n>`: id yêu cầu là chuỗi văn bản. Chưa có quy tắc đánh số. Cần quyết định khi làm đường chấp nhận (4b).
- Nhãn "Bản nháp guide…": nằm trên trang hiển thị, không trong file. Nếu muốn có trong file, phải thêm vào nội dung trước khi gọi bộ ghi.
- Đường chấp nhận yêu cầu (`accepted`) chưa tồn tại. Phải làm trước khi nối bộ ghi vào luồng.

## Chưa làm (cố ý)

- Commit, push, `.done`.
- Đường chấp nhận, lời gọi LLM, bộ sinh bản nháp, nối vào tool registry hoặc MCP.
- Ghi vào `docs/proposals/` thật hoặc `data/`, `data-dev/`.
