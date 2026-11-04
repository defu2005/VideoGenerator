# TASK-026 report — OmniRoute as the LLM gateway

## What changed

### Shared
- `packages/shared/src/schemas/llmGateway.ts` — `LlmGatewaySettings` (`off`/`prefer`/`only` + mappings), catalog model/health schemas, `OMNIROUTE_SETUP_HINT`
- `packages/shared/src/index.ts` — export llmGateway
- `packages/shared/test/llm.test.ts` — parse gateway / catalog / health

### Server
- `apps/server/src/providers/llm/omnirouteCatalog.ts` — catalog parse + 10 phút cache, health (timeout 3s), mapping `provider:model → omniroute`, vision override helper, pricing cache
- `apps/server/src/providers/llm/gatewaySettings.ts` — đọc/ghi `app_settings.llmGateway`
- `apps/server/src/providers/llm/registry.ts` — gắn catalog, loader gateway settings, `suggestModels("omniroute")` lấy từ catalog
- `apps/server/src/providers/llm/structured.ts` — `prefer`/`only` trong `generateRoutedStructured`; fallback gateway chỉ khi lỗi kết nối/5xx; log fallback một lần / signal
- `apps/server/src/providers/llm/pricing.ts` — ưu tiên pricing catalog khi `provider === "omniroute"`
- `apps/server/src/api/llm.ts` — `GET/PUT /api/settings/llm-gateway`, health, catalog, refresh
- `apps/server/src/app.ts` — nạp gateway settings từ sqlite
- Tests: `test/omnirouteGateway.test.ts`

### Web
- `OmniRouteGatewaySection.tsx` — trạng thái (chấm xanh/đỏ), base URL, mode, mapping editor, nút tải lại model, hướng dẫn setup
- `AiSettingsPage.tsx` — nhúng section gateway
- `llmApi.ts` — API client gateway/health/catalog
- `index.css` — style gateway
- Tests: hiện status + lưu mode trong `AiSettingsPage.test.tsx`

## Test counts

| Workspace | After TASK-025 | After TASK-026 |
|---|---|---|
| shared | 197 | **198** |
| mcp | 12 | **12** |
| server | 406 | **413** |
| web | 89 | **90** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. `drizzle-kit generate` → “No schema changes” (dùng `app_settings`, không bảng mới). No `package.json` / lockfile change.

## Live / browser check
- Không chạy OmniRoute thật (user chưa cài). Phủ bằng fake `fetch`: catalog/cache, health up/down, prefer route + fallback 5xx / không fallback 4xx, only preflight, usage + catalog pricing, API settings.
- Web: section gateway hiện status và lưu mode (offline mock).
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Không có. Guide là spec.

## Not done
- No commit/push (per rules).
- Live check với OmniRoute thật trên máy user (sau khi cài + đặt `OMNIROUTE_API_KEY`).
