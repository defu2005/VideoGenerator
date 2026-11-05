# TASK-048 report — User guide

## What changed

### Shared
- `packages/shared/src/features/featureMap.ts` — typed `featureMap` for every user-visible feature so far, plus `GUIDE_PAGES`, `helpHref`, and `featureForPathname`. The first equal-score match owns the "?" link, so the main section of a shared route is listed before the extras.
- `packages/shared/src/features/searchGuide.ts` — heading anchors, section split, and `searchUserGuide` (title match outranks a body mention).
- `packages/shared/src/index.ts` — exports.
- `packages/shared/test/userGuide.test.ts` — ranking, and a help URL for every routed feature.

### Server
- `apps/server/src/help/loadGuide.ts` — finds `docs/user-guide`, allowlists the page stem (`^[A-Za-z0-9-]+$` and `GUIDE_PAGES`), reads Markdown, searches sections.
- `apps/server/src/api/help.ts` — `GET /api/help/search` and `GET /api/help/:page`.
- `apps/server/src/app.ts` — registers the help routes.
- `apps/server/src/assistant/tools.ts` — read tool `search_user_guide`.
- `apps/server/src/assistant/loop.ts` — how-to questions must call that tool and name the section.
- `apps/server/test/help.test.ts` — whitelist, `../` rejection, Telegram and quota ranking.

No schema change, so no migration. A second `drizzle-kit generate` was not required.

### Web
- `apps/web/src/features/help/markdown.tsx` — headings, lists, tables, code, links, images, bold/italic. React text nodes only. No `dangerouslySetInnerHTML`. Guide links like `ho-so.md#dinh-huong` become `/help/ho-so#dinh-huong`.
- `apps/web/src/features/help/HelpPage.tsx` — `/help` and `/help/:page`, search box, scroll to the hash.
- `apps/web/src/features/help/HelpLink.tsx` — the header "?" from the current URL.
- `apps/web/src/features/help/guideCoverage.test.ts` — App routes (except redirects and `*`), profile tabs, project tabs, doc anchors, guide links, secrets, UTF-8, newest `*.done` changelog id.
- `apps/web/src/features/help/markdown.test.tsx`, `HelpLink.test.tsx`, `HelpPage.test.tsx`.
- `apps/web/src/App.tsx` — routes `help` and `help/:page`.
- `apps/web/src/components/layout/AppLayout.tsx` — sidebar **Hướng dẫn** at the bottom of the nav, "?" in the top bar.
- `apps/web/src/index.css` — help layout.

### MCP
- `apps/mcp/src/apiClient.ts` — `searchUserGuide`.
- `apps/mcp/src/tools.ts` — `search_user_guide`.
- `apps/mcp/test/tools.test.ts` — the tool is in the registered list and calls `GET /api/help/search`. This is the only old test whose expected list changed, because the task adds the tool.

### Guide
- `docs/user-guide/` — Vietnamese pages: README (mục lục + bắt đầu nhanh), cài đặt, hồ sơ, dự án và quy trình, hình ảnh và giọng đọc, render và thumbnail, đăng bài, tự động hoá, phân tích và tài chính, bình luận, mô hình AI, trợ lý và Telegram, chế độ ngân sách, an toàn, xử lý sự cố, thuật ngữ, nhật ký thay đổi.
- Button and tab labels were taken from the components (`Generate All`, `Approve`, `Đăng`, `Quota`, `Ghép nối`, `Tạm dừng tất cả`, and the rest).
- No screenshots, so `docs/user-guide/img/` was not created. No tokens, emails, or the protected project id.

### README checklist
`docs/cursor/README.md` already contained rule 10 and the done-checklist user-guide item when this task started. They were not duplicated.

## Test counts

| Workspace | Tests |
|---|---|
| shared | 287 |
| mcp | 13 |
| server | 598 |
| web | 128 |

New tests in this task: shared 4, mcp 1, server 2, web 11. All four counts are above the TASK-017 floors (shared 156, mcp 11, server 295, web 70).

`npm run typecheck`, `npm run build`, and `npm test --workspaces` passed. No `package.json` or lockfile change. No NUL bytes in the new files. Vietnamese guide text is UTF-8. Tests use the mock provider and `app.inject` / mocked `fetch` only.

## Deviations

1. The "?" control sits in the global top bar and follows the URL. It is not copied into every page component. Every `featureMap.webRoutes` entry still resolves to `/help/<page>#<anchor>`. On `/settings/ai` it opens Định tuyến. On a profile automation tab it opens Lịch tự động.
2. Several features share one route (quota and OmniRoute on `/settings/ai`, trends on the automation tab, thumbnail on Render). The first entry wins the "?". The other sections stay in the guide and in `featureMap`.
3. Setup, safety, troubleshooting, the glossary, and the changelog have guide pages and `featureMap` entries with an empty `webRoutes` list, because they are not their own screens.
4. `nhat-ky-thay-doi.md` records TASK-048 in full and short notes for TASK-044 and TASK-045 (both committed 2026-11-05). Older tasks are described in the guide sections via `sinceTask`, not as one changelog block each. The coverage test requires a `## TASK-…` heading for the newest `docs/tasks/*.done` id, which is now TASK-048.
5. The assistant cites the guide only when the model follows the new system-prompt line and calls `search_user_guide`. That call was not made against a real LLM.

## Not done

- No browser screenshots. This session has no browser tool. `npm run dev` was not started: the real worker would use `data/` and could move a live project. The help page, the search box, the "?" link, and HTML escaping were checked in jsdom. The help API was checked with `app.inject` on a temporary database.
- The assistant was not asked "làm sao để kết nối Telegram?" on a live model. `searchGuide("kết nối Telegram")` returns the **Kết nối Telegram** section first, and `GET /api/help/search?q=quota` returns the **Quota** section first.
- Project `56374fb2-54cf-48ff-9441-2e6c653295d4` was not opened, approved, or rendered. The test profile and test project were not opened either, because no screenshot was taken.
