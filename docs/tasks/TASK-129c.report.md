# TASK-129c — báo cáo (trạng thái: ĐÓNG có giới hạn, 2026-11-19)

Ngày: 2026-11-18; cập nhật 2026-11-19. Chưa commit, chưa push.

## Đã làm
- **Bảng mission, máy trạng thái, lệnh một câu:** `apps/server/src/missions/missions.ts`, `checkpoints.ts`, `telegramCommands.ts`, `toolDefs.ts`.
- **Lệnh `/mission` Telegram và công cụ trò chuyện** (chỉ chủ app; API key bị chặn; resume/cancel/create ở chat là hành động cần xác nhận).
- **Trang web `/missions`, `/missions/:id`:** tạo, xem, gỡ chờ (chỉ ở `waiting_user`), huỷ có xác nhận. Duyệt cổng vẫn ở trang dự án. Nhãn mức tự vận hành dùng giá trị thật (`off|assist|supervised|autonomous`).
- **Watchdog nhịp trực** (`supervision/duty.ts` `watchdogDuty`, chạy trong khối 60 giây của worker): báo một lần cho mỗi lần mất nhịp; sự kiện `hermes.duty_watchdog`.
- **Bản tin 21:00** có dòng Mission (`operator/autopilot.ts` `buildDigest`, `operator/supervisor.ts`). Chưa có test khẳng định dòng này; `digestSchedule.test.ts` chỉ kiểm bản tin chung.
- **Mục featureMap, hướng dẫn người dùng** (`docs/user-guide/tu-van-hanh.md` mục "Giao việc một lệnh (Mission)"), nhật ký thay đổi.

## Ánh xạ mục spec → test
| Mục spec | Test | Kết quả |
|---|---|---|
| Lệnh tạo mission và kế hoạch | `missionFlow.test.ts` "a command creates a mission in planning, and the owner writes its plan"; `missions.test.ts` "creates a mission owned by the duty holder…" | Đạt (tạo → ghi kế hoạch) |
| Đường đi tới done | `missionFlow.test.ts` "happy path: planning → producing → scheduled → published → measuring → done"; `missionCheckpoints.test.ts` "runs all four checkpoints to +7 d…" | Đạt cho luồng mốc đo; đăng và đo là fake, không có pipeline thật |
| Cổng không được duyệt → waiting_user, rồi chạy tiếp | Hold theo chế độ dự án: `missionFlow.test.ts` "gate hold…". Đường chat: `missionApprovalPath.test.ts` (3 test, xem dưới) | Đạt theo chế độ app/hồ sơ. Mức mission không được đọc (xem giới hạn) |
| Confirm-risk không bao giờ tự duyệt | `missionToolRegistry.test.ts` "holds resume and cancel as pending actions…"; "holds the chat writers as pending even with autoConfirm…"; `confirmRiskHold.test.ts` (giữ khi tạo, trả lại khi confirm/reject, không trả khi còn action khác cùng dự án, `mission_*` không giữ, args hỏng không ném lỗi); `assistantConfirmRiskHold.test.ts` (7, qua assistant thật, gồm giới hạn: action hết hạn rồi reject action khác cùng dự án thì mission chờ cũ chạy lại) | Đạt |
| Chuyển quyền trực giữ mission | `missions.test.ts` "hands open missions to the new duty holder…" | Đạt |
| Dự án được bảo vệ bị từ chối | `missions.test.ts` "refuses the protected project" | Đạt |
| Dòng Mission trong bản tin 21:00 | Không có test khẳng định | **Chưa kiểm** |

## Đường chat qua cổng (`apps/server/test/missionApprovalPath.test.ts`, 3/3)
Đi qua `AssistantService` thật và `invokeRegistryTool` với `source: "assistant"`. Orchestrator.approveGate là spy; mọi thứ khác là thật.
1. **Mức mặc định (assist, không cấp SCRIPT):** `approve_gate` SCRIPT trả `pending`, mission `waiting_user`, spy chưa gọi. `confirmAction` → spy gọi đúng một lần, mission `producing`.
2. **Đối chứng (supervised, cấp SCRIPT):** cùng lệnh trả `result`, không tạo action chờ, spy gọi một lần, mission vẫn `producing`. Có seed một script đạt điểm 9 để cổng chất lượng script không giữ lệnh.
3. **Confirm lỗi:** spy ném lỗi → `ACTION_FAILED`, mission vẫn `waiting_user`.

Nguồn mức: `effectiveAutonomy` (`operator/autonomy.ts:45`) đọc cài đặt app (`app_settings`) và hồ sơ, KHÔNG đọc mức lưu trên hàng mission. Vì vậy test đổi mức bằng `saveAutonomySettings`.

Đường hold/resume: `assistant/service.ts:528` (tạo action giữ mission), `releaseAfterPendingAction` khi confirm/reject (`service.ts` ~466–490; `missions/checkpoints.ts:236`).

## Kiểm chứng đã chạy
- `apps/server/test/workerWatchdogWiring.test.ts` — vòng 60 giây của worker gọi `watchdogDuty` mỗi phút. Pass cùng `worker.test.ts` (8/8).
- `apps/mcp/test/eventPollLoop.test.ts` — vòng poll 15 giây của `sync.ts` (tách thành `runEventPollLoop`). Pass 9/9 cùng `sync.test.ts`; `tsc` apps/mcp exit 0.
  - Đổi hành vi có chủ ý: trước đây lỗi từ một lần poll làm vòng lặp dừng; nay vòng lặp bỏ qua lỗi và poll tiếp.
- Test mission phía server (`missionOrchestratorHold`, `dutyWatchdog`, `missions`, `missionTelegram`, `missionToolRegistry`): 38/38 pass (2026-11-18).
- Web: `MissionsPage.test.tsx` 4/4 pass (gồm nhãn mức tự vận hành mới). `tsc --noEmit` exit 0; vitest 89 file / 242 test pass (2026-11-18).
- Server, 2026-11-19 (sau khi thêm `missionApprovalPath.test.ts`): `tsc --noEmit` exit 0; `npx vitest run` 246 file pass / 4 skip; 1966 test pass / 8 skip / 0 fail.
- Server, 2026-11-18: `npm run build` exit 0.
- Ghi chú fixture: pipeline harness dùng dự án không thuộc `TEST_WORKSPACE_ID`, nên `createMission` từ chối; test gắn dự án bằng SQL (giống `missionOrchestratorHold.test.ts`). Lỗi fixture, không phải lỗi sản xuất.
- `missionFlow.test.ts` 3/3, `missions`, `missionPreview`: pass.
- **Chưa kiểm chứng trên trình duyệt.** Trang Mission trên dev server (`data-dev`) chuyển về `/setup` vì chưa có tài khoản chủ sở hữu.

## Giới hạn (ghi nhận khi đóng)
- **Mức mission không được đọc.** `effectiveAutonomy` chỉ đọc cài đặt app và hồ sơ. Mức lưu trên mission không điều khiển cổng nào. Không có nút nâng mức từng mission trên web.
- **Mức không điều khiển ba cổng thật.** `approveGates` của preset liệt kê TOPIC/RESEARCH/SCRIPT; `GATES` là VISUAL_REVIEW, MUSIC_REVIEW, FINAL_APPROVAL. Ba cổng thật do chế độ dự án và `autoRender` quyết.
- **Agent không qua lưới quyền.** `registry/invoke.ts` truyền `autonomy` = undefined khi `source` là agent. `approve_gate` từ agent chạy theo logic giữ/sửa của cờ `gated`: `autonomyGates.test.ts:127` (approve_gate với `gated`) và `autonomyGates.test.ts:413` (MCP agent bị cổng).
- **Confirm lỗi giữ mission chờ.** Đã thiết kế như vậy và có test (ca 3).
- **Dòng Mission trong bản tin 21:00 chưa có test.**
- Trang web chưa hiện xem trước cổng (API có `preview`); chưa kiểm trình duyệt; pipeline thật chưa end-to-end.

## Lịch sử trạng thái
- 2026-11-18: MỞ ở một phần tiêu chí.
- 2026-11-19: thử chặn cổng AUTO theo mức mission (`missionGateBlock`) rồi gỡ. Lý do: `GATES` không khớp `approveGates`; preset mặc định không cấp cổng nào, nên sẽ chặn mọi cổng AUTO; runner truyền `autoBlock` = undefined.
- 2026-11-19: thêm `missionApprovalPath.test.ts`; mức được đọc từ cài đặt app; đóng có giới hạn như trên.
