# TASK-141 — báo cáo sửa (fix report)

Trạng thái: P1 và P2 đã làm và có test. Advisor đã nêu bốn yêu cầu cho P2; các yêu cầu đó đã được xử lý (xem mục P2). Chưa commit, chưa push.

## Vấn đề gốc

1. **Nhịp (pacing) đo sai đơn vị.** Trước đây nhịp lấy độ dài cảnh hoặc thời lượng giọng đọc. Độ dài cảnh không phải nhịp cắt.
2. **Liền mạch không được sửa.** Lệch màu và thiếu mô-típ chỉ được báo, không đi qua vòng sửa chất lượng.

## P1 — nhịp đo theo shot, không đo theo cảnh

- `packages/shared/src/schemas/continuity.ts`: đánh giá nhịp chỉ trên shot đã kiểm (`getValidatedComposePlan`). Không có shot thì không có finding `pacing`.
- `apps/server/src/continuity/check.ts`: `estimatedPacing = composePlan === null`. Đã bỏ logic ước lượng theo shot.
- `apps/server/src/services/visualService.ts` (`continuityRank`): khi không có shot hợp lệ, thành phần nhịp dùng mục tiêu của kế hoạch (`envelope.plan.pacing[kind]`), nên trung tính.
- Test: cảnh 7,4 s không có shot không sinh `pacing`; kế hoạch có shot 20 s sinh một finding; bốn shot 5 s trong cảnh 20 s không sinh finding; `continuityRank` với cảnh 60 s không bị phạt (mutation: thay fallback bằng `60` làm test FAIL, đã khôi phục và `cmp` khớp).
- Kiểm văn bản: `apps/web/src/features/visuals/ContinuityFindings.tsx` chỉ ghi "ước tính" khi chưa có kế hoạch compose; khớp với code.

## P2 — liền mạch đi qua vòng sửa

- `packages/shared/src/repair/quality.ts`: thêm `continuity_color` (thang: `pick_next_candidate`) và `continuity_motif` (thang: `research_scene`, `pick_next_candidate`). `pacing` và `character_mismatch` không có hành động tự động.
- `apps/server/src/operator/qualityRepair.ts`:
  - `diagnose` ánh xạ `color_jump` sang `continuity_color` trên cảnh sau của cặp, và `motif_missing` sang `continuity_motif` trên cảnh có mô-típ thiếu. Cảnh `owned` và `noVisual` bị bỏ qua.
  - `repairStep` đọc phát hiện liền mạch qua `VisualService.repairContinuityFindings`, chỉ khi gate là VISUALS.
  - Bộ lọc best-effort: một issue `continuity_*` bị bỏ khi `nextLadderAction` không còn bậc chưa thử cho loại đó trong cửa sổ. Motif vẫn đi hết thang; cổng không bị shelve vì lỗi liền mạch đã hết thang.
- `apps/server/src/services/visualService.ts`: `repairContinuityFindings` gọi `checkContinuity` không có context (không gọi model, không ghi `CONTINUITY_REPORT`).
- Liền mạch chỉ được đọc khi `runQualityRepair` chạy cho VISUAL_REVIEW, qua `approve_gate` có quyền tự sửa. Chúng không tự làm cổng thất bại.

### Test P2 (apps/server/test/qualityRepair.test.ts)

| Test | Kiểm gì |
|---|---|
| mapping | `color_jump` → `continuity_color` trên `sceneIds[1]`; `motif_missing` → `continuity_motif` trên `sceneIds[0]`; owned/noVisual bị bỏ |
| ladder | `nextLadderAction` hết bậc trả null |
| colour once per window | bước 1 chạy `pick_next_candidate`; bước 2 `passed`, không `exhausted` |
| motif ladder | bước 1 `research_scene`; bước 2 `pick_next_candidate`; bước 3 `passed` |
| two colour jumps | cửa sổ chỉ có một lần thử (loop guard chặn lặp); cặp thứ hai không được thử lại; cổng `passed` |

### Mutation proof

- Đổi `sceneIds[1]` → `[0]`: test mapping FAIL. Đã khôi phục, `cmp` khớp.
- Thay bộ lọc bằng `false`: ba test liền mạch FAIL (colour once, motif ladder, two colour jumps). Đã khôi phục từ bản sao và `cmp` khớp (`qr-p2fix.ts` trong scratchpad).

### Quyết định ghi lại

- Thang theo loại, không theo cảnh (giống `chooseRepair`). Cặp lệch màu thứ hai trong cùng cửa sổ không được thử. Cổng qua; cặp đó chỉ được xử lý sau khi cửa sổ reset.
- Vòng lặp chặn lặp cùng hành động trên cùng đầu vào cổng. Vì vậy hai cặp lệch màu trong một bước chỉ có một lần thử.

## Docs (rule 12)

- `docs/user-guide/nhat-ky-thay-doi.md`: một dòng cho TASK-141 P2 (dòng 13).
- `docs/ARCHITECTURE.md` mục 13: đã mô tả bộ lọc theo bậc và giới hạn đã chấp nhận.
- `.agents/skills/video-hinh-anh-va-giong/SKILL.md`: mô tả hành vi sửa khi duyệt VISUAL_REVIEW có quyền tự sửa.
- `docs/tasks/GOAL-2026-11-18.decisions.md`: các quyết định P1 và P2.

## Kiểm tra

- `apps/server`: qualityRepair, continuity, visual, operator: 11 file, 121 test pass. Assistant catalog 14/14 (cap 40000 ở `test/assistant.test.ts:490`).
- `apps/server` tsc: 3 lỗi, đúng bằng baseline.
- `packages/shared` đã được build lại sau khi sửa `quality.ts`.

## Chưa xong / ngoài phạm vi

- `packages/shared/test/budget.test.ts` (6 test đỏ) và `apps/server/test/budget.test.ts` (1 test đỏ): nằm ngoài TASK-141. File `packages/shared/src/budget/modes.ts` và `packages/shared/test/budget.test.ts` đã có thay đổi chưa commit trước khi làm goal này; không được sửa trong phạm vi này.
- Web: toàn bộ suite pass (87 file, 235 test). Test VisualReview keyboard không tái hiện được lỗi đỏ đã ghi trước đó (4 lần chạy đều pass).
