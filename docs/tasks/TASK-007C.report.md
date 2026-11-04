# TASK-007C report — Web image search (Brave + Gemini grounding)

Guide `docs/cursor/TASK-007C.md` thay spec LLM-agent cũ: tìm ảnh web bằng search API + crawl code, không dùng tool web của LLM agent / agy.

## What changed

### Shared
- `packages/shared/src/schemas/visual.ts` — providers `brave` / `web-grounding`; fields `licenseVerified`, `sourcePageUrl?`, `why?`; helpers `isWebImageProvider`, `isUnverifiedWebCandidate`
- `packages/shared/src/budget/modes.ts` — feature `webImageSearch` (ECO 0 / BALANCED 3 / QUALITY 8 / MAX 999); estimate thêm grounding batches + lý do Brave requests; `webImageSearchSceneCap`
- `packages/shared/src/schemas/llm.ts` — task `webImageGrounding`
- `packages/shared/src/schemas/webImage.ts` — settings + status schemas (keyConfigured, monthly Brave counter)
- `packages/shared/src/visuals/license.ts` — `licenseFromCcUrl`
- Tests: `budget.test.ts`, `license.test.ts`, `llm.test.ts`

### Server
- `providers/images/webCrawl.ts` — SSRF-safe HTML fetch, robots.txt, denylist (Pinterest luôn chặn), `extractPageImages`, Commons license helper, page cache hooks
- `providers/images/brave.ts` — Brave Image Search API
- `providers/images/webGrounding.ts` — Gemini `google_search` grounding; chỉ tin `groundingMetadata` URIs
- `providers/images/crawlToCandidates.ts` — crawl pages → candidates / enrich Brave license
- `providers/images/types.ts` — optional `licenseVerified` / `sourcePageUrl` / `why`
- `lib/config.ts` + `.env.example` — `BRAVE_SEARCH_API_KEY`, `WEB_IMAGE_GEMINI_MODEL`, `WEB_IMAGE_SEARCH_PER_MINUTE`, `WEB_IMAGE_DOMAIN_DENYLIST` (**không** sửa `.env`)
- `settings/webImage.ts` + `api/webImageSettings.ts` — GET/PUT `/api/settings/web-image`
- `services/visualService.ts` — `webSearch()`, pipeline hook sau stock rank (cap theo budget), `approveAll` + AUTO preselect bỏ unverified web, usage `braveImageSearchRequests` / grounding calls
- `api/visuals.ts` — `POST .../scenes/:sceneId/visuals/web-search`
- Migration `drizzle/0019_black_hydra.sql` — `source_page_url`, `license_verified`, `why`
- Fixtures + `test/webImageSearch.test.ts`

### Web
- Nút **Tìm trên web**, badge **Web**, `why`, cảnh báo “Chưa xác minh license” + link trang nguồn
- Settings page **Nguồn ảnh web** (`/settings/web-image`)
- `BriefFields` CUSTOM toggle `webImageSearch` + gợi ý ước tính
- Tests: VisualReview, WebImageSettingsPage, budget estimate text updates

## Test counts

| Workspace | Before (TASK-004G report) | After |
|---|---|---|
| shared | 176 | **178** |
| mcp | 12 | **12** |
| server | 323 | **340** |
| web | 74 | **76** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile changes.

## Live check

**live check not run: no key** — không đọc `.env`; không yêu cầu key. Chưa chạy Brave/Gemini thật trên project throwaway. Không đụng project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the (old) spec

- Spec cũ (LLM agent / agy full access / provider `ai-web`) **bị guide thay thế**; implement theo Brave + Gemini grounding + crawl code.
- Gemini grounding gán page URL round-robin theo scene trong batch (metadata grounding không index theo scene).
- Brave monthly counter đọc `jobs.usage.features.braveImageSearchRequests` trong tháng lịch hiện tại.

## Not done

- Live web search trên throwaway project với key thật.
- Browser UI smoke trên throwaway project (unit/API coverage thay thế).
- No commit/push (theo rules).
