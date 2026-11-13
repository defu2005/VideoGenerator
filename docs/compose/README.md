# Compose

Bản đồ module cho TASK-067b và TASK-068. Chỉ gọi hàm đã export.

## Shared (`packages/shared/src/compose/`)

| File | Hàm | Việc |
| --- | --- | --- |
| schema.ts | `validateScenePlan`, `shotFrames` | Kiểu cảnh quay, giấy phép, kiểm tra phủ hết cảnh |
| words.ts | `sceneWords`, `cutCandidates` | Từ trên đồng hồ cảnh, chỗ cắt ở giữa khoảng lặng |
| beats.ts | `detectBeats`, `musicToSceneBeats` | Nhịp 70–180 BPM và nhịp theo cảnh |
| pacing.ts | `paceBand`, `paceSpan` | Chỗ cắt bằng quy hoạch động |
| metrics.ts | `computeStats` | Entropy, cụm cùng kiểu, cắt đúng nhịp |
| footage.ts | `rankFootage`, `assignFootage`, `pickInSec` | Xếp clip theo cảnh, ngưỡng 0,45 |
| index.ts | | Xuất lại các hàm trên |

## Server

| File | Hàm | Việc |
| --- | --- | --- |
| providers/footage/registry.ts | `searchFootage` | Pexels và Pixabay, bỏ clip không có tác giả hoặc giấy phép |
| providers/footage/download.ts | `ensureFootage`, `pickFootageFile` | Tải file nhỏ nhất đủ nét, trần 60 MB |
| compose/hyperframes.ts | `renderComposeTemplate` | Mẫu toàn màn, cache `compose-cache` |
| compose/render/still.ts | `renderShot` | Ảnh tĩnh qua `buildSceneClipPlan` |
| compose/render/footage.ts | `renderShot` | Cắt clip, không lặp |
| compose/render/graphic.ts | `renderShot` | Chữ động hoặc biểu đồ, rồi mã hoá lại |
| compose/sceneClip.ts | `renderComposedScene` | Nối cảnh quay, đúng số khung |
| compose/director.ts | `baselineDirector` | Một khoảng: footage nếu có ít nhất 2 clip, không thì ảnh |
| compose/composeService.ts | `planProject`, `renderSceneClip` | Lập kế hoạch và dựng một cảnh |
| compose/eval/runEval.ts | `planEval`, `runComposeEval` | Bài đo legacy và compose, không gọi mạng |
| compose/beatsFile.ts | `beatGridForMusic` | Giải mã nhạc 11025 Hz, cache JSON |
| assets/compose/kinetic_text | | Chữ hiện theo thời điểm |
| assets/compose/chart | | Cột mọc trong 0,6 giây |

`lang/` xuất `getLangPack` (vi, en, hoặc chỉ chữ số). `numbers.ts` xuất `parseNumbers`, `comparableGroups`, `startsWithOrdinal`, `findContrastWord`. `variety.ts` xuất `checkVariety` và `enforceVariety` cho luật V1–V4.

`planProject` không đụng cơ sở dữ liệu. Cảnh không hợp lệ lùi về một ảnh tĩnh.
Mặc định của app là compose từ TASK-070. Chọn `legacy` trong kiểu dựng để về đường cũ.

Đồ hoạ toàn cảnh có ba mức trong ngân sách: `off` (không chữ động, biểu đồ, bản đồ, so sánh, câu trích, danh sách), `static` (một khung đã xong, ffmpeg mờ 0,2 giây và zoom chậm) và `animated` (MP4 đặc, chất lượng standard). Hạt nhiễu chỉ khi `graphicGrain` bật. Ước tính thời gian là `estimateRenderSeconds` trong shared, khoảng ±40%.

**Graphic templates (TASK-067b part 2).** `apps/server/assets/compose/common.js` is the shared template runtime (`window.VGInit()`: safe box, colours, 3 background variants, `fitText`, `layout`, `at`, `finish`); new graphic kinds should reuse it. `apps/server/src/compose/render/graphicVars.ts` builds the template variables (contrast-safe colours, `variant = FNV-1a(projectId + shotId) % 3`, number format by language). `VG_COMPOSE_SAMPLES=1` in `apps/server/test/compose.eval.test.ts` renders the PNGs in `docs/compose/samples/` with real HyperFrames. Full-size graphic shots cost about 16–38 s each to render.

**Directors (TASK-067b part 1, TASK-070b).** `apps/server/src/compose/director/index.ts` exports `ruleDirector` (vi), `createRuleDirector({ language })` and `createLlmDirector(llm, { language, onWarning })`. Rules live in `rules.ts` (reasons `R1-numbers` … `R10-list`), chart labels and per-language edge words in `labels.ts`, the single LLM call and its per-scene fallback in `llm.ts`. The variety pass appends `+V1-run` etc. to reasons. `pickDirector` uses the rule director, and the quality director when the budget is not ECO. The LLM call is one per plan and is recorded on the existing `editPlan` task.
