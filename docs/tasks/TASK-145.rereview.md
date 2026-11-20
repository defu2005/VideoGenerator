# TASK-145 — Rà soát lại (rereview), cập nhật 2026-11-19

**Kết luận: CHẤP NHẬN (đóng theo test và quyết định advisor).** Ba mục chặn trước đây đã đóng: (1) lỗ hổng hold, quyết định giữ hành vi hiện tại và có test khóa; (2) counter theo mode, đã thêm counter runtime có pin số lần gọi; (4) `render.test.ts` thuộc TASK-138 (FileGc), không chặn TASK-145. Benchmark CLI và bằng chứng modelEval 10 fixture (row 15–16) vẫn hoãn theo ruling advisor, không chặn chấp nhận. Chưa commit, chưa push.

**Quyết định do advisor đưa ra thay người dùng (người dùng có thể đảo lại):**
- Hold rule: giữ hành vi hiện tại. Blocking fact không bao giờ được approve; khi còn ngân sách revise thì revise, hết ngân sách thì hold. Không đổi sản phẩm. Guide dòng 116 không cấm rõ vòng revise, nên không quay lại hỏi advisor.
- Counter theo mode: không thêm counter runtime trong sản phẩm. Thêm test runtime trong `task145ModeCounters.test.ts` (mock provider, đếm lần gọi trong `runStoryEngine`, đối chiếu cap và pin số đo được).
- `render.test.ts`: không chặn TASK-145 vì thay đổi chỉ thuộc storage GC (TASK-138). Thay đổi không chạm script hay storyEngine.

Đợt này không xác nhận được đâu là sửa mới trong `apps/server/src/stages/script/storyEngine.ts` (bindSectionsToBeats, keepScriptMetadata, gain rule, rewrite merge) so với các đợt trước. Các phần đó được kiểm qua test và mutation ở bảng dưới, nhưng không khẳng định là thay đổi của đợt này. Sửa rõ ràng trong đợt này là `scriptService.ts` (switchHook, rescoreCritique), đã kiểm bằng test và mutation F1–F4.

## Thay đổi đợt này
- `storyEngine.ts`: `bindSectionsToBeats` (định nghĩa dòng 795, gọi dòng 432) gắn section với beat theo thứ tự; cùng số beat thì một section một beat; cùng số run thì một section một run; còn lại giữ metadata writer, bỏ factIds ngoài outline, ghi log `[beat-binding]`. `keepScriptMetadata` (định nghĩa dòng 848, gọi dòng 702): length fit chỉ đổi text. Đổi số section thì revert. Id, sectionKey, beatPurpose, emotion, visualIntent, factIds, loops lấy từ script hiện tại theo index (ghi đè, không revert riêng).
- `scriptService.ts`: switchHook và rescoreCritique có kiểm job đang chạy, kiểm version/hash, và ghi job FAILED kèm usage khi trả 409 sau lần gọi trả phí; rescore giữ `blocking_facts` đã lưu (dòng 636).
- Test mới (đếm theo `^\s*it(` hoặc `test(`):
  - `task145Integration.test.ts` (6): qua `runStoryEngine`, row 8 (2), hold (2), row 9 (2).
  - `task145EngineRows.test.ts` (4): gain 1, gain 2, gain 0 revert, row 10.
  - `task145ServiceRows.test.ts` (8): row 2 switchHook (4: 409 do version, 409 có job FAILED kèm usage, 409 chỉ đổi hash, happy path SUCCEEDED); row 12 blocking_facts (4).
  - `task145HoldRule.test.ts` (4): biên ngưỡng hold (total < 60, accuracy < 3, blocking) và rewrite.
  - `task145HoldGate.test.ts` (6): `scriptGateDecision`. Thêm mới: "never approves a blocking fact at any revise round, even with minQualityScore 0 and a top score" (vòng 0–2 không approve; vòng 0 revise; vòng 2 hold).
  - `task145OldScript.test.ts` (2): script cũ không có trường beat parse và planScenes.
  - `task145OldScriptRender.test.ts` (1): do session `local_e55c051f` viết, render script cũ qua fake ffmpeg. Khẳng định render ok, số clip bằng số scene, thứ tự hook/section/outro.
  - `task145PaidFence.test.ts` (6): 4 ca fence assert 0 lần gọi provider; 2 ca đối chứng assert 1 lần gọi.
  - `task145Snapshot.test.ts` (4): hành vi `script_drafts` trong snapshot và invalidation. Guide dòng 136 yêu cầu đăng ký `script_drafts` như output của SCRIPT; đã có ở `apps/server/src/pipeline/dataContract.ts:27`.
  - `task145ModeCounters.test.ts` (5): 3 test bound của `estimateBudget` (storyOutline QUALITY max 4, BALANCED max 3, SCRIPT max = tổng cận task) và 2 test **counter runtime** mới: lite 3–7 lần gọi và pin 6; full 4–10 lần gọi và pin 7. Đo bằng mock provider qua `runStoryEngine` với fixture RUN_RESEARCH; khẳng định `fallback === false`. Cap lấy từ `packages/shared/src/budget/modes.ts` dòng 500 (full 10, lite 7).
  - `task145HoldFloor.test.ts` (2): ca 5.5 với một blocking fact, mặc định, qua `scriptGateInputs` + `scriptGateDecision` → "revise" ở vòng 0. Tên test đã ghi rõ quy tắc hiện tại.
  - `storyEngine.test.ts` (11, trong đó 6 ở describe `beat metadata binding (TASK-145 P2)`) và `storyEngineGates.test.ts` (12): test cũ được bổ sung.
- Ngoài TASK-145 (không tính vào bảng): `apps/server/test/render.test.ts` +35 dòng (import `FileGc`, test "keeps a published version and render inputs while collecting archived intermediates"). Thuộc TASK-138 (`apps/server/src/storage/fileGc.ts`, `docs/tasks/TASK-138.fix3.md`). Không đụng script hay storyEngine.

## Bảng finding
| # | Finding (review) | Sửa trong code | Test | Trạng thái |
|---|---|---|---|---|
| 1 | P1 rescore bỏ qua computeScriptCritique và job/usage | `scriptService.ts` rescoreCritique; 409 ghi job FAILED có usage (dòng 703) | `storyEngine.test.ts` "records the paid rescore usage as FAILED…"; test rescore | **Đỏ: mutation 1 — 1 fail / 30 pass (31)** |
| 2 | P1 ghi đè không kiểm phiên bản (switchHook, rescore) | switchHook: `atomic` (dòng 481) + kiểm version/hash (483–484), job SUCCEEDED (526), FAILED (532–533). rescore: `atomic` + CONCURRENT_MODIFICATION (653–656) | `task145ServiceRows.test.ts` 4 test switchHook; `storyEngineGates.test.ts` (accounting switchHook) | **Đỏ: 2a 3/17 (20); 2b 1/19 (20); 2c 2/18 (20); 2d 1/19 (20)** |
| 3 | P1 viết lại cục bộ (allowlist) | merge chỉ thay section trong `failingSectionIds`, giữ object gốc (~615–625) | `storyEngine.test.ts` "rewrite merge changes only failing sections…" | **Đỏ: mutation 3 — 1 fail / 10 pass (11)** |
| 4 | P1 switchHook viết lại cả section | chỉ đổi câu đầu | `storyEngine.test.ts` "handles hook switching…" | **Đỏ: mutation 4 — 1 fail / 10 pass (11)** |
| 5 | P2 điều kiện dừng (gain < 3) | gain ≤ 0 revert; gain < 3 dừng sau khi nhận (614–629) | `task145EngineRows.test.ts`; `storyEngineGates.test.ts` "gain of 2", "gain of 3" | **Đỏ: 5a 2/14 (16); 5b 3/13 (16); 5c 1/15 (16)** |
| 6 | P2 ngân sách không khớp | storyOutline max = 2 + repairs; SCRIPT max = tổng cận task. Bound ở `packages/shared/src/budget/modes.ts` dòng 497–503 | `task145ModeCounters.test.ts` (bound từ `estimateBudget` + counter runtime lite/full) | **Đóng cho đường happy path (mock, không có vòng rewrite).** Mutation H (lite chạy hook assessment): 1 fail / 4 pass (5), báo `expected 7 to be 6`. Mutation I (cap rewrite của lite từ 1 lên 2, dòng 510): **survive**, 13/13 file 71/71 pass. Trung thực: không mutation đơn nào đẩy lite vượt cap 7 trên fixture này; pin chính xác là phần nhạy; cap rewrite của lite không được bảo vệ |
| 7 | P2 repair outline và trần retry | một lần repair (`repairAttempts`); usage ghi ở đường thành công và đường lỗi | `storyEngineGates.test.ts` (4 test outline/repair) | **Đóng theo test; không có mutation** |
| 8 | P2 metadata beat không được ràng buộc | `bindSectionsToBeats` (795, gọi ở 432) | `storyEngine.test.ts` (6 test describe beat binding); `task145Integration.test.ts` "rebound to the outline beats by order", "writer count matching neither…" | **Đỏ: 8a 2/15 (17); 8b 1/16 (17)** |
| 9 | P2 length fit đổi metadata | `keepScriptMetadata` (848, gọi ở 702): đổi số section thì revert; đổi id/sectionKey/factIds thì ghi đè từ script hiện tại | `storyEngine.test.ts` "length fit cannot change beat metadata…"; `task145Integration.test.ts` (2 test) | **Đỏ: 9a 2/15 (17); 9b 1/16 (17)** |
| 10 | P2 lịch sử hook đọc chosenId | recentHookTactics đọc `chosenHookId ?? chosenId` (~880) | `task145EngineRows.test.ts` row 10; `storyEngineGates.test.ts` "recentHookTactics" | **Đỏ: 10a 2/14 (16); 10b 2/14 (16)** |
| 11 | P2 USER luôn stale | `critiqueStale` so `input_hash` với hash nội dung (234–240) | test rescore khẳng định `critiqueStale` = false | **Đỏ: mutation 11 — 1 fail / 10 pass (11)** |
| 12 | P2 blocking_facts bị gán lại | `scriptService.ts:636` `Math.max(currentBlocking, accuracy < 3 ? 1 : 0)` | `task145ServiceRows.test.ts` 4 test rescore; `storyEngineGates.test.ts` "rescore keeps a stored blocking fact" | **Đỏ: 12a 2/18 (20); 12b 3/17 (20)** |
| 13 | P2 prompt rescore: 7 chiều, chỉ gửi summary | `storyEngineGates.test.ts` "row 13" khẳng định prompt có `researchFacts` và rubric 6 chiều | Có test. **Không có mutation trong `mut_summary.txt`/`mut2_summary.txt`** | **Đóng theo test; không có mutation** |
| 14 | P2 GET draft với outline null sau rescore | guard trong scriptService (~244–251) | `storyEngineGates.test.ts` "row 14". **Không có mutation** | **Đóng theo test; không có mutation** |
| 15 | P2 benchmark CLI | chưa sửa; hoãn theo ruling advisor | Không | **Hoãn, không chặn** |
| 16 | P2 bằng chứng modelEval 10 fixture | `storyEngine.test.ts` "verifies the 10 benchmark fixtures…" chỉ kiểm schema | Có (schema) | **Hoãn, không chặn** |
| 17 | Đường dẫn trong report (`shared/src/llm/tasks.ts`) | Đường dẫn đúng: `packages/shared/src/schemas/llm.ts:118` (`LLM_TASKS`) | Không cần | **Đóng (sửa đường dẫn trong report)** |
| 18 | Test theo danh sách review | xem chi tiết dưới | xem dưới | **Đóng. Hold và counter đã quyết và có test; render.test.ts không thuộc TASK-145** |

### Chi tiết row 18
- Outline invalid → repair → fallback: `storyEngineGates.test.ts` (row 7). **Đóng.**
- Length-fit revert (tích hợp): `task145Integration.test.ts`. Mutation 9a/9b đỏ. **Đóng.**
- Snapshot/invalidation (guide dòng 136): `task145Snapshot.test.ts` (4 test). Mutation S1 (chuyển owner sang `control`) đỏ 4/4. **Đóng.**
- Paid tool fencing: `task145PaidFence.test.ts`; mutation F1–F4 đỏ, mỗi cái 1 fail / 5 pass (6). **Đóng** cho bốn fence trong scriptService.
- Old-script render (guide dòng 230): `task145OldScriptRender.test.ts` pass 1/1 khi chạy riêng và trong full suite 2026-11-19. **Đóng cho yêu cầu render.** Chưa có mutation trên file này.
- Mode counters: **đóng cho happy path.** Test bound cộng 2 test runtime (lite 3–7, pin 6; full 4–10, pin 7). Chạy 5/5 pass. Mutation H đỏ đúng một ca. Các test này chỉ chạy đường mock không có rewrite; cap rewrite của lite (guide dòng 121–126: lite tối đa một lần rewrite) **không được bảo vệ**, mutation I survive (xem Còn mở 2b). Các bound trong test là bản sao được pin, không đọc từ `modes.ts` lúc chạy.
- Hold: **đóng theo quyết định advisor.** Hành vi hiện tại được giữ và khóa bằng test. Blocking fact không bao giờ approve (HoldGate, vòng 0–2, minQualityScore 0, điểm 9). Với 5.5 và một blocking fact: revise ở vòng 0, hold ở vòng 2. Guide dòng 116 nói "hold khi có blocking facts", còn đường thật revise đến khi hết ngân sách. Đây là chênh lệch đã ghi nhận, người dùng có thể đảo lại.

### Lỗ hổng hold (đã quyết, không sửa)
Quyết định đi qua `scriptGateDecision` (`packages/shared/src/schemas/autonomy.ts:194`): score ≥ minQualityScore và guidelinePass và blockingFacts === 0 → approve; còn ngân sách revise (round < maxRevise = 2) → revise; hết ngân sách → hold.

- `task145Integration.test.ts` (nhóm "hold outcome through runStoryEngine") khẳng định giá trị với total 55, accuracy 2: `fallback === false`, `critique.total === 55`, `qualityScore === 5.5`, `blockingFacts === 1`.
- `scriptCritiqueNeedsHold` (`packages/shared/src/script/critique.ts:42`) không có caller trong `apps/server/src` hay `apps/web/src`.
- Ngưỡng `minQualityScore` đọc từ spec (`apps/server/src/operator/qualityGates.ts` 28–37, mặc định 7); `autonomy.ts:125` mặc định 7, sàn 0. Sàn 0 có thể approve 5.5 nếu spec đặt thấp. Đã ghi là finding không chặn: `PROPOSALS_AND_BUGS.md` mục 20 (`BUG-TASK145-HOLD-FLOOR-009`).

## Kiểm chứng đã chạy
- **Full suite server, verbose, một lần, sau khi xác nhận không session nào đang chạy** (`scratchpad/full_suite_rereview2.txt`; 2026-11-19 08:09:13–08:13:01 UTC; exit 0): Test Files **261 passed | 4 skipped (265)**; Tests **2039 passed | 8 skipped (2047)**. Gồm `task145OldScriptRender.test.ts` và hai test runtime mới của `task145ModeCounters.test.ts`.
  - Skip đã định danh: 4 file bị skip cả file (`compose.eval.test.ts`, `structuredGraphicSamples.test.ts`, `workerNodeE2E.test.ts`, `load/controlPlaneLoad.gated.test.ts`); 1 test trong `motion.test.ts`. Tổng 8 test.
  - Kiểm session trước khi chạy (`list_sessions` linked): cả năm `isRunning: false`. Hoạt động gần nhất: `local_e55c051f` 07:55:30 UTC; các session còn lại trước 07:42:49 UTC. Không có session nào hoạt động trong cửa sổ 08:09–08:13.
  - Lần chạy trước (`scratchpad/full_suite_clean.txt`, 260/2035) không có OldScriptRender và không có test runtime mới. Chỉ dùng để so sánh.
  - Cây làm việc vẫn có thay đổi chưa commit của các task khác. "Sạch" chỉ nghĩa là một lần chạy, verbose, không phải git sạch.
- **13 file TASK-145 chạy lại 2026-11-19:** 13 file, 71 test, 71 pass.
- `apps/server`: `npx tsc --noEmit`: exit **0**.
- Baseline cũ, để so sánh: 249 file, 1987 test.

### Mutation
Mỗi mutation áp một lần bằng `scratchpad/mut.mjs` hoặc `mut2.mjs` (hoặc sed/cp có backup `scratchpad/bak/`), chạy file chỉ định, khôi phục, `cmp` xác nhận. Kết quả trong `mut_summary.txt` (19 dòng), `mut2_summary.txt` (5 dòng), và mutation H ghi ở row 6.
- Đợt 1: 1: 1/30 (31); 2a: 3/17 (20); 2b: 1/19 (20); 2c: 2/18 (20); 2d: 1/19 (20); 3: 1/10 (11); 4: 1/10 (11); 5a: 2/14 (16); 5b: 3/13 (16); 5c: 1/15 (16); 8a: 2/15 (17); 8b: 1/16 (17); 9a: 2/15 (17); 9b: 1/16 (17); 10a: 2/14 (16); 10b: 2/14 (16); 11: 1/10 (11); 12a: 2/18 (20); 12b: 3/17 (20).
- Đợt 2: F1–F4 (switchHook/rescore bỏ kiểm job, hook lạ, expectedVersion): mỗi cái 1/5 (6); S1 `script_drafts` chuyển owner sang `control`: 4/4 (4).
- Mutation H (row 6): `if (engineMode === "lite") {` → `if (false) {` trong storyEngine.ts; số lần gọi lite 6 → 7; `task145ModeCounters.test.ts`: 1 fail / 4 pass (5), `expected 7 to be 6`. Đã khôi phục, `cmp` OK.
- Mutation I (row 6, cap rewrite lite 1 → 2 tại `storyEngine.ts` dòng 510): **survive**, 13/13 file, 71/71 pass. Đã khôi phục, `cmp` OK. Log: `scratchpad/mut510_run.txt`.
- Chưa có mutation cho: row 7, 13, 14, và `task145OldScriptRender.test.ts`. Các row này đóng theo test, ghi rõ trong bảng.
- `scratchpad/` là thư mục tạm của phiên, có thể bị dọn. Kết quả trong doc này lấy từ các file đó; file lưu lâu dài là doc này.

## Còn mở (không chặn chấp nhận)
1. **Benchmark CLI và modelEval 10 fixture (row 15–16):** hoãn theo ruling advisor.
2. **Chênh lệch hold so với guide dòng 116:** đã quyết giữ hành vi hiện tại. Người dùng có thể đảo lại và yêu cầu hold ngay khi có blocking fact.
   - 2b. **Cap rewrite của lite không được bảo vệ:** mutation I survive. Test runtime chỉ đi đường happy path (mock critic đạt, không có vòng rewrite). Hướng sửa (không làm trong đợt này): test có critic trượt để ép vòng rewrite, rồi đếm lần gọi lite ≤ 6.
3. **Sàn `minQualityScore` 0 (PROPOSALS_AND_BUGS.md mục 20):** finding mở, không chặn.
4. **`storyEngine.ts` và một số file test TASK-145 chưa được theo dõi bởi git (`??`), chưa commit.**

Verdict: **CHẤP NHẬN** với các mục trên. Chưa commit, chưa push.

## Ghi chú đợt sau (không chặn TASK-145)
- 147d: giờ đã được mở khóa về mặt phụ thuộc (145 đã chấp nhận).
- 147a, 149, 150: cần review.
- 147b/c: mục docs và test submit protected-project còn mở.
- 139, 141, 143, 135b/c: cần sửa sản phẩm (một writer cho mỗi nhóm file).
- 073d, 074b/c: chưa kiểm lại trạng thái.
- 081 (conflict resolution): chưa kiểm lại trạng thái.
- `apps/server/test/render.test.ts`: thay đổi thuộc TASK-138 (FileGc), không thuộc TASK-145. Cần TASK-138 nhận và xác nhận.
- Handoff: memory `C:\Users\defu\.claude\projects\C--Users-defu-Documents-videoGenerator\memory\current-handoff.md`. `docs/cursor/current-handoff.md` không tồn tại.
