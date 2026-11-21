# TASK-173 — `linkKnown` line 51 (`uploadStore.ts:49–56`): đọc khả năng tới, không đổi `src`

Trạng thái: **đã đọc, không đo.** Không đổi `src`, không có test mới. Kết luận: dòng 51 không tạo kẹt job trên đường đã đọc. Đây không phải sửa cứng (hardening).

## Dòng 51

`linkKnown` trả `true` ngay khi đã có row cùng `(jobId, leaseId, name)` không ở trạng thái `partial`, mà không kiểm tra file của row `linked` còn trên đĩa. Nếu cùng lease gọi `/have` lần hai sau khi file đã mất, tên đó được báo "have", node không tải lại, và `complete` gặp 422 `LINKED_FILE_MISSING` (TASK-167).

## Kết quả đọc

**Đường job (`node_uploads`): không có lần offer thứ hai trong cùng lease.**
- `agent.ts:649–683` (`uploadOutputs`): mỗi lần gọi đăng ký `/have` đúng một lần, rồi tải các file không có trong `have`.
- `agent.ts:794` (job thường) và `agent.ts:858` (đường thứ hai) đều: `uploadOutputs` một lần, `complete`, lỗi thì `/fail` (`retryable: true`). Không có vòng lặp gọi lại trong cùng lease.
- `uploadStore.ts:37` (`validate`) và `get` (`:23–25`) khóa theo `(jobId, leaseId, name)`. Lần retry chạy trên lease mới (`leaseService.ts:235`), nên không thấy row cũ. `linkKnown` khi đó gọi `locate`, file không còn thì trả `false`, và node tải lại. Đây là một lần retry, không phải kẹt.
- Test `leaseRetryAfterMissingLink.test.ts` đã phủ chuỗi 422 → `/fail` → retry (TASK-162/163/167).

**Đường run (`run_uploads`): offer lặp lại dưới cùng lease là bình thường.**
- Mỗi checkpoint gọi `uploadOutputs` (`agent.ts:558–559`), và `files` là các file của **một** bản ghi stage `DONE` (`projectRunner.ts:292`, `exportProjectRows(..., record.stage)`). Không tích lũy toàn run, nhưng cùng một sha có thể xuất hiện ở hai stage, nên cùng tên `files/<sha>` có thể được offer lại dưới cùng lease.
- Khi file còn tồn tại, lần offer lại trả "have" và không có hại.
- Dòng 51 chỉ thành vấn đề nếu file liên kết mất **giữa hai lần offer** của một run đang chạy.

**Ai có thể xóa file liên kết của run đang chạy?**
- `.node-runs/…` chỉ được ghi ở `runTransport.ts:108`. Không có code xóa `.node-runs`. Không có cleanup nào cho `run_uploads` (chỉ `uploadStore.ts:125` xóa khi sha lệch, lúc đang tải).
- Target liên kết là artifact đã đăng ký trong project (`insideProject`, `runTransport.ts:67–73`), không phải `.node-runs`.
- GC: `references.ts:126` giữ tham chiếu của `run_uploads` khi run còn active. Run đã kết thúc thì không được giữ, nhưng file chỉ bị xóa nếu không còn tham chiếu nào khác (chưa đo).
- `removeProjectDir` (`storage/paths.ts:39`): không có caller nào trong `apps/`.
- `projectRunner.prune` (`projectRunner.ts:79–97`): chỉ quét `<DATA_DIR>/runs`, còn target phải nằm dưới `<DATA_DIR>/projects/<id>`. Hai cây không chồng nhau, nên loại.
- `voiceExecutor.ts:217–218`: xóa `audio_path` cũ của voice track. Track TTS không đi qua `/have` của job render, nên không phải target liên kết của node upload. (Chưa đọc đường gọi TTS offer để xác nhận.)
- `executeRender.ts:221`: xóa `versionDir` của chính render vừa thất bại. Chỉ chạm file của renderId đó. Nếu renderId trùng một row DONE khác (case collision TASK-170), có thể mất file. Đường này chưa đo.

## Điểm không thuộc (d), ghi nhận

`registerSync` (`artifactService.ts:33`) gọi `statSync` không bắt lỗi. Khi file liên kết của run đã mất, `checkpoint` accept (`runTransport.ts:58`) ném `ENOENT` thay vì 409 `RUN_FILE_CHANGED` mà đoạn mã ngay trước đó định dùng. Chưa đọc node làm gì với lỗi này. Đây là một vấn đề khác. Đã sửa ở TASK-174: ENOENT ở checkpoint accept nay trả 409 `RUN_FILE_CHANGED` (xem `docs/tasks/TASK-174.report.md`).

## Premise TASK-172 (`composeBridge.ts`)

- `composeBridge.ts:341` là `previewRenderEstimate`, chỉ phục vụ ước lượng.
- `composeBridge.ts:171` (`lockedShots`) nằm trong `prepareComposePlan` (`:112–230`), gọi từ `renderService.ts`. Nó chỉ mang các shot **đã khóa** của plan cũ sang plan mới, nên shot được giữ là shot được chọn.
- Chưa đọc: director có thể bỏ một shot đã khóa mà still của nó vẫn nằm trong bundle hay không. Nếu có thì premise "still không được chọn" vẫn chưa đóng.

## Quyết định

- Không đổi `src`, không viết test. Dòng 51 không gây kẹt job.
- Dòng 51 có thể chạm tới run đang chạy chỉ khi file liên kết mất giữa hai checkpoint. Chưa tìm thấy remover nào làm vậy dưới tham chiếu đang active.
- Mục theo dõi: `registerSync` ném ENOENT ở checkpoint accept; `executeRender.ts:221` với renderId trùng; director bỏ shot đã khóa.
