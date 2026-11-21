# TASK-174 — `registerSync` ném ENOENT ở checkpoint accept → 409 `RUN_FILE_CHANGED`

Trạng thái: **đã sửa, đã kiểm thử (đỏ → xanh), chưa push.** Một commit local, theo quyết định của advisor.

## Vấn đề

Khi file checkpoint đã được tải lên nhưng bị xóa trước khi checkpoint được chấp nhận, `registerSync` (`apps/server/src/node/artifactService.ts`) gọi `statSync` không bắt lỗi. Lỗi `ENOENT` thoát ra khỏi resolver ở `apps/server/src/node/runTransport.ts`, và handler toàn cục biến nó thành `500 INTERNAL_ERROR`. Đoạn mã ngay trước đó đã định dùng `RUN_FILE_CHANGED` (409) cho trường hợp này nhưng không bắt được ENOENT.

## Test đỏ (trước khi sửa)

Test mới trong `apps/server/test/runTransport.test.ts`: "maps a checkpoint file deleted after upload to RUN_FILE_CHANGED, not a raw ENOENT". Test tải file lên, `unlinkSync` file đã lưu, rồi kỳ vọng `checkpoints.apply` ném lỗi có `code: "RUN_FILE_CHANGED"`, `statusCode: 409`, `lastSeq` 0 và không có row nào trong `subtitle_tracks`.

Kết quả trước khi sửa: lỗi thô `ENOENT: … stat`, đúng như advisor dự đoán.

## Thay đổi

`apps/server/src/node/runTransport.ts`, resolver của checkpoint (dòng 55–65): bọc `registerSync` trong `try/catch`. Nếu lỗi có `code === "ENOENT"` thì ném `AppError(409, "RUN_FILE_CHANGED", …)`, các lỗi khác vẫn ném nguyên. Phần kiểm tra sha/size/insideProject giữ nguyên.

`registerSync` không đổi; các caller khác của nó không bị ảnh hưởng.

## Test xanh (sau khi sửa)

- `runTransport.test.ts`: 7/7 xanh.
- `runSnapshotRepointsPending.test.ts` (kiểm soát TASK-168): lúc đầu fail vì nó khẳng định ENOENT thô. Đã cập nhật tiêu đề và assertion sang `RUN_FILE_CHANGED`/409. Sau khi sửa: 2/2 xanh.
- Full server suite, chạy một mình, log sạch: **Test Files 307 passed | 4 skipped (311); Tests 2529 passed | 9 skipped (2538); exit 0.**

Lần chạy đầu của full suite có 2528 passed và 1 fail (chính test kiểm soát TASK-168, trước khi cập nhật assertion). Đó là lần chạy đúng như kỳ vọng, không phải lỗi mới.

## Ba điểm đã đọc (không đổi code)

1. **Node có retry checkpoint không?** Không. `agent.ts` `call()` (~dòng 344) không retry. `request()` (~dòng 509) ném `AppError(response.status, …)` với mọi response không OK. Cả 409 và 500 đều rơi vào `catch` của `startProject`, run bị bỏ, không gửi `finish`/`fail`. Vì vậy patch chỉ đổi status và code, không đổi hành vi node. Nó không chứng minh cũng không sửa được vòng lặp retry nếu có.
2. **LOST và re-grant.** `runService.expire()` (dòng 139–142) đặt `LOST`/`HEARTBEAT_LOST`. `projectPlacement.ts` (~dòng 107–120) loại trừ cùng node khi run cuối của nó là `LOST`, và run được grant lại sẽ có lease mới.
3. **Nhịp heartbeat.** `heartbeatMs` mặc định 15 000 (`agent.ts:177`). Heartbeat đặt `RUNNING` và gia hạn `lease_until`. Run cùng lease chỉ được chọn lại nếu còn `GRANTED` ở lúc checkpoint lỗi, nghĩa là không có heartbeat trong ~15 s sau khi grant. Việc này được đánh giá là không chắc xảy ra, nhưng chưa chứng minh là không thể.

## Ghi chú về load

Lần chạy full suite đầu tiên (`baseline-test.log`) bị nhiễm vì hai lần chạy chồng nhau. Có 6 fail (visionMax 4, clips 1, thumbnails 1). Lần chạy sạch `clean-test-run.log` và lần chạy này đều không tái hiện. Ghi nhận là test nhạy với tải, không phải lỗi do task này.

## Ngoài phạm vi (không làm)

- `linkKnown` dòng 51 (TASK-173): không đổi, theo quyết định của advisor.
- `executeRender.ts:221` với renderId trùng; director bỏ shot đã khóa (TASK-172): theo dõi, chưa mở.
- TASK-168 ứng viên (a): mở rộng guard TASK-166 cho `run_uploads` của run chưa xong, chưa làm.
