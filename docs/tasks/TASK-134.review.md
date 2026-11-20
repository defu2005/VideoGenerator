# TASK-134 — review (2026-11-19, Claude, không phải review độc lập)

**Kết luận:** phần lớn đạt theo đọc code và test. Chưa chấp nhận hoàn toàn vì còn ba nhóm test trong guide chưa thấy. Không sửa `TASK-134.done` hay `TASK-134.report.md`.

## Đã kiểm
- Test chạy lại hôm nay (6 file, 62 test, pass; 2 file dataContract/nodeUploadStore, 4 test pass):
  - `dataContract.test.ts`: registry phủ bảng project/scene; input version ổn định, bỏ timestamp và hàng downstream; giữ công việc hoàn tất, chạy lại một lần khi đầu vào đổi, chấp nhận phiên bản khớp (`STALE_INPUT_MESSAGE`, job SUCCEEDED, stage STALE).
  - `workerNodes.test.ts`: upload dừng 40% rồi tiếp tục sau khi control khởi động lại; hai `complete` đồng thời chỉ một thắng; phục hồi claim của control đã chết không cần lease render mới; sha256 sai bị từ chối và xóa tệp tạm; `have` dùng lại tệp đã biết; lease hết hạn bị từ chối finalize.
- Migration của TASK-134 là `0081_tiresome_quicksilver`. `0082_lonely_darkstar` (`project_runs`) và các file sau thuộc công việc khác (135a trở đi), không tính vào review này.
- Thời gian input version: báo cáo ghi 679,8 ms lần nguội, 54–83 ms các lần sau, vượt 200 ms ở lần nguội. Báo cáo đã nêu rõ và dùng cache theo thiết bị/inode/mtime/ctime. Chấp nhận như đã ghi.

## Ba mục tưởng là thiếu (đã kiểm lại, đều có assertion)
1. **Upload sai offset → 409:** `workerNodes.test.ts:304–345` (tên "resumes a 40% PATCH upload…") gửi PATCH với `upload-offset: 2` và assert 409, sau đó tiếp tục từ 4 đến 10 và kiểm `have`. Tầng lưu cũng có `nodeUploadStore.test.ts:26` (`UPLOAD_OFFSET_MISMATCH`, 409).
2. **`invalidated_at` khi markStaleFrom trên stage đang chạy:** `dataContract.test.ts:90` assert `invalidatedAt` truthy sau `markStaleFrom(...,"SCRIPT")` khi RENDER đang chạy.
3. **Chạy toàn bộ xếp lại đúng một lần:** `dataContract.test.ts:70–104`: job đầu SUCCEEDED với STALE_INPUT_MESSAGE; `retry` là job QUEUED duy nhất (`getActiveJobs` rỗng sau khi kết thúc lần chạy lại). Lần chạy lại thứ hai dùng `runRender` và đạt DONE khớp `inputVersion`. Test này không đếm số lần xếp lại một cách tường minh, nhưng mọi bước đều assert trạng thái cụ thể.

## Đọc code: thứ tự claim trước khi ghi file
- `node/leaseService.ts:582–593` (đường S3 direct): `claimFinalization` chạy trước vòng `renameSync`/`saveVerified`; `finalizeHeld` nhận `directClaimed`.
- `leaseService.ts:624–626` (đường voice/media): `claim` được truyền vào `completeVoice`/`completeMedia` và gọi trước khi ghi.
- `leaseService.ts:549` (`saveVerified` khi nhận upload): chạy lúc upload, trước `complete`, nên không phải finalize.
- Test `workerNodes.test.ts` "rejects an expired finalizer and lets exactly one concurrent complete claim the lease" và "recovers a claim left by a crashed control" bảo vệ thứ tự này.

## Kết luận cập nhật
- Đạt. Không còn mục test mở.
- Kiểm trình duyệt: báo cáo gốc ghi đã kiểm bằng API giả lập; không chạy lại trong đợt này.
- `TASK-134.done` và `TASK-134.report.md` không đổi.
