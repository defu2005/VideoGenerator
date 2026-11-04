# TASK-022 report — Profiles (Hồ sơ) and platform accounts

## What changed

### Shared
- `packages/shared/src/schemas/profile.ts` — `PlatformId` / `AccountFormat` / publish settings / `Profile*` / `PlatformAccount*` schemas; `defaultFormatForPlatform`, `mainAspectFromFormats`, `channelDirectionBlock`, `appendChannelDirection`
- `packages/shared/src/schemas/project.ts` — optional `profileId` on `Project` / `CreateProjectInput` / `ProjectListQuery`
- `packages/shared/src/index.ts` — export profile schemas
- `packages/shared/test/profile.test.ts` — format defaults, `autoPublish` false, direction truncation

### Server
- `apps/server/src/db/schema.ts` — `profiles`, `platform_accounts`, nullable `projects.profile_id`
- `apps/server/drizzle/0021_shiny_jubilee.sql` (+ meta snapshot/journal) — generated migration (CREATE order fixed so `profiles` exists before FK from `platform_accounts`)
- `apps/server/src/services/profileService.ts` — CRUD, archive, accounts, settings seed, `getProfileDirection`
- `apps/server/src/api/profiles.ts` — routes from the guide
- `apps/server/src/services/projectService.ts` — create/list with `profileId`; inherit brief/voice/guidelines/llm/mode; aspect from main account format; request overrides win
- `apps/server/src/jobs/jobRepository.ts` — map `profile_id`
- Prompt inject “Định hướng kênh”: `research/prompt.ts`, `script/prompt.ts`, `mergedStoryPrompt.ts`, `metadataPrompt.ts`, `sceneQueryPrompt.ts` + callers (research/script/scene executors, metadataService, script API)
- `apps/server/src/app.ts` — register profile routes; wire profile service into project create
- `apps/server/test/profiles.test.ts` — CRUD, archive, account delete 409 when connected, project inherit + aspect, direction in script prompt / prompts API

### Web
- Nav + routes: `AppLayout.tsx`, `App.tsx`
- `apps/web/src/features/profiles/` — list + detail tabs (Định hướng / Brief mặc định / Tài khoản / Dự án)
- `apps/web/src/services/profilesApi.ts`, `hooks/useProfiles.ts`
- `CreateProjectDialog.tsx` — Hồ sơ select fills form
- `ProjectListPage` / `ProjectFilters` / `ProjectCard` — profile chip + filter
- `index.css` — profile card/chip/account styles
- Tests: `ProfileListPage.test.tsx`; create-dialog fill-from-profile

### MCP
- `list_profiles` tool; `create_project` accepts `profileId` (`tools.ts`, `apiClient.ts`, tools test list)

## Test counts

| Workspace | Before (TASK-021 report) | After |
|---|---|---|
| shared | 185 | **190** |
| mcp | 12 | **12** |
| server | 365 | **373** |
| web | 78 | **80** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change.

## Live / browser check
- Throwaway profile via API: create → add YouTube account (`NOT_CONNECTED`, landscape) → list → archive. UTF-8 direction (`Kênh thử nghiệm throwaway`) OK via Node fetch.
- `GET http://127.0.0.1:5180/profiles` → 200.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Migration SQL CREATE order was reordered after generate so `profiles` is created before `platform_accounts` (drizzle emitted the reverse; SQLite FK would fail). Snapshot left as generated.
- Projects tab on the profile page lists projects as simple links (not full `ProjectCard` action menus).

## Not done
- OAuth connect / publish (TASK-024+); connect button is a disabled placeholder.
- No commit/push (per rules).
