# TASK-145 — Hướng dẫn benchmark kịch bản (bench:script)

Tài liệu này mô tả CLI `apps/server/src/cli/benchScript.ts`: cách chạy, DB lấy từ đâu, cách tính điểm, và những gì CLI chưa làm. Các khẳng định đã đối chiếu với code ngày 2026-11-19 và có dẫn dòng. Phần "Chưa kiểm chứng" (mục 8) liệt kê những điều không xác minh được.

## 1. Cách chạy

Lệnh (đã đối chiếu): `"bench:script": "tsx src/cli/benchScript.ts"` trong `apps/server/package.json`, tên package `@vg/server`. Chạy từ gốc repo:

```
npm run bench:script -w @vg/server
```

- Đây là chạy tay; file không nằm trong bộ test.
- Đầu ra: `tmp/bench-script-<YYYY-MM-DD>.md` (`benchScript.ts` dòng 355–356). Đường dẫn `tmp` là tương đối, nên thư mục thực tế phụ thuộc cwd của npm. Theo hành vi của npm, `-w` chạy trong thư mục workspace, tức `apps/server/tmp`. Đây là suy luận từ hành vi npm, chưa chạy để xác nhận.
- Lệnh `--variant <id>` không có tác dụng trong CLI này. `parseVariantArg` và `runVariantBench` tồn tại (dòng 137–160), nhưng `main()` (dòng 162–360) không gọi chúng. Dòng 148 ghi rõ điều này.
- CLI gọi các route LLM theo `parseConfig()`, đọc `.env` tại `workspaceRoot` (`config.ts` dòng 24). Nó không khẳng định provider nào được dùng; xem mục 8.

## 2. Đường dẫn DB

`main()` gọi `parseConfig()` rồi `openDatabase(config.DATABASE_PATH)` (dòng 164–165). Trong `apps/server/src/lib/config.ts` (dòng 386–388):

1. Nếu `DATABASE_PATH` được đặt: dùng nó. Đường dẫn tương đối được resolve theo `workspaceRoot`.
2. Nếu không: `join(DATA_DIR, "app.db")`. `DATA_DIR` mặc định `./data` (dòng 53), resolve theo `workspaceRoot` (dòng 362–364).

`workspaceRoot = findWorkspaceRoot(process.cwd()) ?? process.cwd()` (dòng 23). Hàm `findWorkspaceRoot` chưa đọc.

Lưu ý: benchmark dùng cùng `sqlite` handle để tạo `LlmCache` và truyền vào `runStoryEngine`. Vì vậy nó chạm vào DB mà `.env` trỏ tới, không phải DB riêng. `openDatabase` (`db/client.ts`) đặt WAL, `busy_timeout` và `synchronous` (dòng 28–30). Việc có migrate hay ghi dữ liệu khi mở DB chưa được xác minh.

## 3. Baseline và fallback

- **Baseline:** `runBaselineScript` trả `costUsd: 0` cứng (dòng 127). Đây không phải chi phí đo được; chỉ token được ghi.
- **Fallback:** khi `engineRes.fallback` đúng, CLI chạy `runBaselineScript` thay cho engine, gán `engineCritiqueScore = 50` cứng (dòng 245), và tính `engineTokens` chỉ từ `spentInputTokens + spentOutputTokens` của engine (dòng 244). Token của lần chạy fallback không được cộng vào `engineTokens`. Một điểm 50 trong báo cáo nghĩa là engine đã fallback, không phải điểm chấm thật.
- Trong fallback, cả hai bên đều dùng `runBaselineScript`. Hai lần gọi dùng cùng `cacheKeyExtra` (`bench:baseline:<id>`). Cache được tạo với `enabled = false` (dòng 167, `new LlmCache(sqlite, false)`), và `LlmCache.get` trả `undefined` khi tắt (`providers/llm/cache.ts` dòng 10). Vì vậy hai lần gọi không lấy kết quả từ cache, và hai script có thể khác nhau. Việc `set` có bị bỏ qua khi tắt hay không chưa được đọc.

## 4. Hai cột điểm không cùng nguồn và không cùng thang

- **Cột engine:** `engineCritiqueScore = engineRes.draft.critique.total` (dòng 249). Điểm này do critic của engine chấm, trong lúc engine chạy. Nó không đến từ judge blind. Công thức lấy từ `computeScriptCritique` (`packages/shared/src/script/critique.ts` dòng 32–37), trọng số 20/20/20/15/15/10 (`SCRIPT_CRITERION_WEIGHTS`), thang 0–100.
- **Cột baseline:** `baselineTotal = (tổng 6 tiêu chí của judge cho baseline) × (100/30)` (dòng 304–305). Điểm này do judge blind chấm, không trọng số.

Hệ quả:
- Hai cột được chấm bởi hai nguồn khác nhau (critic của engine và judge blind) và dùng hai công thức khác nhau. Không so sánh trực tiếp.
- Judge còn chấm script của engine (`scoresA` hoặc `scoresB` còn lại), nhưng CLI không dùng điểm đó. Chỉ điểm baseline và nhãn `winner` được dùng.
- Đây là khoảng trống đối chiếu với `TASK-145.rereview.md` dòng 28 (mục 15). Code không ghi lý do chủ đích, nên không nói đây là lựa chọn có chủ ý.
- Chỉ nhãn `winner` (đã map về engine/baseline/TIE ở dòng 295–302) là thước đo chung cho cả hai bên.

## 5. Số liệu thiếu được báo là thiếu, không phải 0

Báo cáo hiện có (dòng 332–353):
- số fixture, số thắng và hòa, tỉ lệ phần trăm của thắng;
- bảng theo fixture: id, chủ đề, nhãn thắng, điểm engine, điểm baseline, token engine, token baseline;
- ghi chú judge (`reasoning`) cho từng fixture.

Báo cáo **không có**:
- trung bình theo từng tiêu chí (structure, hook, accuracy, ttsNatural, visualizable, originality). Không có đoạn code nào tính trung bình.
- chi phí USD. `costUsd` chỉ được gán 0 cho baseline (dòng 127) và không được đưa vào báo cáo; không có cột chi phí.

Khi đọc báo cáo, không hiểu vắng mặt như "không tốn chi phí" hay "điểm trung bình 0". TASK-145.md mục 6 yêu cầu các số này. Đây là mục 15 đang mở trong `TASK-145.rereview.md`.

## 6. Judge dùng chung route scriptCritic, nhưng prompt khác critic

- Judge gọi `registry.resolveTask("scriptCritic", project)` (dòng 264) và `generateRoutedStructured` với `task: "scriptCritic"` (dòng 276–279). Route `scriptCritic` là cùng route mà critic của engine dùng (`storyEngine.ts` dòng 321 và 451).
- Khác biệt về routing: CLI không truyền `appRouting`. Engine truyền `appRouting` vào `resolveTask` (`storyEngine.ts` dòng 321, 451), và `appRouting` là tham số của `runStoryEngine` (dòng 100, 117). Judge gọi không có tham số thứ ba. Cấu hình routing theo app không áp dụng cho judge; cách `resolveLlmRoute` xử lý thiếu tham số này chưa được đọc.
- Prompt của judge khác với rubric critic. Judge dùng system prompt riêng (dòng 282: "You are an expert impartial video judge..."), không dùng `CRITIC_RUBRIC_SYSTEM_PROMPT` từ `critique.ts`. Prompt người dùng (dòng 265–274) không có trọng số. Schema là `BlindJudgeSchema` (dòng 45–64), không phải `ScriptCritiqueSchema`.
- `TASK-145.md` mục 6 nói "a third route" cho judge. Code dùng `scriptCritic`, không phải một route thứ ba riêng.

## 7. Blind và thứ tự A/B

- `isEngineA = Math.random() < 0.5` (dòng 260). Thứ tự A/B ngẫu nhiên cho từng fixture; `blindOrder` được ghi lại (dòng 312–315).
- Judge chỉ thấy "SCRIPT CANDIDATE A" và "B" dưới dạng JSON (dòng 270–271); không có nhãn engine hay baseline.
- Fixture được duyệt theo `STORY_ENGINE_BENCHMARK_FIXTURES` (dòng 182). Mỗi fixture chạy đúng một lượt, không lặp (dòng 182–324, không có vòng lặp lại).

## 8. Chưa kiểm chứng

- `findWorkspaceRoot` tìm gốc repo như thế nào (mục 2).
- `resolveLlmRoute` xử lý `appRouting` bị thiếu ra sao (mục 6).
- Provider và model thực tế của `script`, `storyOutline`, `scriptCritic` khi chạy. `LLM_ENABLE_MOCK` mặc định là `!isProduction` (`config.ts` dòng 383: `LLM_ENABLE_MOCK: values.LLM_ENABLE_MOCK ?? !isProduction`). Nên ngoài production, mock có thể được bật; không xác định được route thực đang trỏ tới provider nào.
- `LlmCache.set` khi `enabled = false` (có bỏ qua ghi hay không).
- `openDatabase` có migrate hay ghi khi mở DB không.
- Kết quả thật của benchmark: chưa có. Không gọi LLM, không chạy CLI, không rebuild `packages/shared`.

Đã kiểm chứng bằng đọc code (không chạy): mục 2 (thứ tự lấy DB), mục 3 (baseline cost 0, fallback 50, `engineTokens` không gồm token fallback, cache tắt), mục 4 (hai nguồn điểm và trọng số), mục 5 (thiếu means và cost), mục 6 (judge dùng `scriptCritic`, không truyền `appRouting`, prompt khác rubric), mục 7 (blind và một lượt).

## 9. Tóm tắt

1. DB: `DATABASE_PATH` nếu có; không có thì `DATA_DIR/app.db` (mặc định `./data/app.db`). Chạm cùng DB với `.env`.
2. Baseline cost luôn 0 (cứng), không phải chi phí đo được.
3. Fallback engine gán điểm 50 cứng; token của lần chạy fallback không tính vào engine.
4. Cột engine lấy từ critic của engine (có trọng số). Cột baseline lấy từ judge blind (không trọng số). Không so sánh thẳng.
5. Báo cáo thiếu trung bình theo tiêu chí và chi phí USD. Vắng mặt nghĩa là chưa có, không phải 0.
6. Judge dùng route `scriptCritic` chung với critic của engine, nhưng không truyền `appRouting` và có prompt riêng.
7. `--variant` không được `main()` dùng.
