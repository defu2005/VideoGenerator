# TASK-007B report — Thêm nguồn ảnh

Guide `docs/cursor/TASK-007B.md` mở rộng stock/museum image providers; video clip B-roll và watermark nâng cao **out of scope**.

## What changed

### Shared
- `packages/shared/src/enums.ts` — license kind `PIXABAY`
- `packages/shared/src/schemas/visual.ts` — providers `pixabay`, `unsplash`, `nasa`, `met`, `loc`, `smithsonian`, `europeana`, `flickr`; `STOCK_IMAGE_PROVIDERS`
- `packages/shared/src/schemas/imageSources.ts` — settings + status schemas (enabled, keyConfigured, requestsPerMinute; không lộ key)
- `packages/shared/src/visuals/license.ts` — normalizers Pixabay / Unsplash / NASA / Met / LoC / Smithsonian / Europeana / Flickr
- `packages/shared/src/visuals/sourcePriority.ts` — `preferredSources()` (0 LLM keyword routing)
- Tests: `license.test.ts`, `sourcePriority.test.ts`

### Server
- Providers: `pixabay.ts`, `unsplash.ts`, `nasa.ts`, `met.ts`, `loc.ts`, `smithsonian.ts`, `europeana.ts`, `flickr.ts`
- `registry.ts` — đăng ký providers mới; skip khi thiếu key
- `lib/config.ts` + `.env.example` — keys + `IMAGE_SEARCH_PER_MINUTE_*` (**không** sửa `.env`)
- `settings/imageSources.ts` + `api/imageSourcesSettings.ts` — GET/PUT `/api/settings/image-sources`
- `services/visualService.ts` — filter theo settings; reorder/limit qua `preferredSources`; Unsplash `download_location` ping khi select / AUTO preselect (một lần, lỗi chỉ warn)
- Fixtures + tests: `imageProviders.test.ts`, `imageSourcesSettings.test.ts`

### Web
- Trang **Nguồn ảnh** (`/settings/image-sources`): bật/tắt, trạng thái key, lượt/phút
- Nav link trong `AppLayout`
- Test: `ImageSourcesSettingsPage.test.tsx`

## Test counts

| Workspace | Before (TASK-007C report) | After |
|---|---|---|
| shared | 178 | **185** |
| mcp | 12 | **12** |
| server | 340 | **357** |
| web | 76 | **78** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile changes. No migration (settings dùng `app_settings` JSON có sẵn).

## Live check

**live check not run** — không gọi mạng thật trong session này; không đụng project `56374fb2-54cf-48ff-9441-2e6c653295d4`. Providers không cần key (NASA, Met, LoC) có fixture + unit tests.

## Deviations from the spec

- Spec ghi Pixabay/Pexels **video** clip; guide xếp **out of scope** → chưa làm.
- Watermark detection nâng cao → chưa làm (theo guide).
- Unsplash vẫn hotlink CDN URL theo guideline Unsplash (khác Pixabay bắt buộc tải local — image store đã tải khi approve/render).

## Not done

- Live search NASA/Met/LoC trên project throwaway.
- Browser UI smoke trên throwaway project (unit/API coverage thay thế).
- Pexels/Pixabay video B-roll.
- No commit/push (theo rules).
