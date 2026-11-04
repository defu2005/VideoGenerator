# TASK-027 report — LLM model advisor

## What changed

### Shared
- `packages/shared/src/schemas/llm.ts` — `modelAdvisor` task id; `qualityWeight` / `needsVision` / `needsLongContext` on `LLM_TASKS`; `ProfileLlmSettings` (+ `autoModel`); propose/apply/proposal schemas
- `packages/shared/src/budget/modes.ts` — budget feature `modelAdvisor: true` in every preset (ECO…MAX)
- `packages/shared/src/schemas/profile.ts` — profile `llm` uses `ProfileLlmSettings`
- Tests: `packages/shared/test/llm.test.ts`, `packages/shared/test/budget.test.ts`

### Server
- `apps/server/src/services/modelAdvisor.ts` — catalog/health builders, validation (invalid / non-vision / mock), 24h proposal cache in `app_settings`, propose + apply (app / profile / project, partial `taskIds`)
- `apps/server/src/api/llm.ts` — `POST /api/llm/advisor/propose`, `POST /api/llm/advisor/apply`; task catalog includes qualityWeight
- `apps/server/src/app.ts` — pass `profileService` into LLM routes
- `apps/server/src/providers/llm/mock.ts` — `ModelAdvisor` mock answer from catalog
- `apps/server/src/services/profileService.ts` — `ProfileLlmSettings`; seed project LLM without `autoModel`
- `apps/server/src/db/schema.ts` — llm column typed as `ProfileLlmSettings`
- Tests: `apps/server/test/modelAdvisor.test.ts`; call-site fix for `registerLlmRoutes(..., fetchImpl)` in omniroute/llmProviders tests

### Web
- `ModelAdvisorPanel.tsx` — nút «Gợi ý model bằng AI», bảng task / hiện tại / đề xuất / lý do, checkbox từng dòng, Áp dụng
- `AiSettingsPage.tsx` — nhúng panel (scope app)
- `ProfileDetailPage.tsx` — toggle «Tự chọn model» + panel (scope profile) trên tab Brief mặc định
- `llmApi.ts` — propose/apply clients
- `index.css` — style bảng advisor
- Tests: `ModelAdvisorPanel.test.tsx`; budget-estimate fixture có `modelAdvisor` trong `ProjectDetailPage.test.tsx`
- `BriefFields.tsx` — CUSTOM toggle cho `modelAdvisor`

## Test counts

| Workspace | After TASK-026 | After TASK-027 |
|---|---|---|
| shared | 198 | **199** |
| mcp | 12 | **12** |
| server | 413 | **420** |
| web | 90 | **91** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. `drizzle-kit generate` → “No schema changes” (dùng `app_settings` + JSON `profiles.llm`, không bảng mới). No `package.json` / lockfile change.

## Live / browser check
- Không gọi LLM/network thật: propose dùng mock provider; cache/validation/apply phủ bằng unit + inject API.
- Web: panel render bảng và áp dụng dòng đã chọn (offline mock).
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- `autoModel` nằm trong `profiles.llm` (JSON) thay vì cột DB riêng — tránh migration, vẫn default `true`.
- `modelAdvisor` có trong budget features mọi mode nhưng **không** cộng vào `estimateBudget` pipeline (giống reviewChat: gọi từ UI/settings, không phải Generate All).
- Latency health lấy từ duration job (usage call không có `durationMs`); parse failures ước lượng từ `ok: false`.

## Not done
- No commit/push (per rules).
- Automation TASK-028 chưa re-run advisor theo `autoModel` (chỉ lưu toggle + apply API).
