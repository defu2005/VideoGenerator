# TASK-022 — Cursor guide (Profiles and platform accounts)

Read `docs/cursor/README.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
The user runs **several accounts**. Each one is its own **profile** ("Hồ sơ") with its own direction: niche, audience, tone, language, voice, guideline pack and default brief. A profile owns one or more **platform accounts** (for example the YouTube channel "Lịch sử 5 phút" plus the TikTok account of the same brand). The user can create many profiles, and a profile can have several accounts on the same platform.

This task only adds the data model, API and UI. It makes no OAuth connection and does not publish: those come in TASK-024/025. A platform account here is just a record, with `connection: "NOT_CONNECTED"`.

## Data model (`apps/server/src/db/schema.ts`, then `npx drizzle-kit generate`)
- `profiles`
  - `id`, `name` (unique), `description`
  - `direction`: free Vietnamese text. This is what the channel is about, its angle, what to avoid. The LLM later reads it to suggest topics and to steer scripts.
  - `language`, `default_brief` (JSON, same shape as `VideoBriefSettingsSchema` plus `mode` and `autoRender`), `voice` (JSON like `ProjectSettings.voice`), `guidelines` (JSON, `GuidelineSettingsSchema`), `llm` (JSON, `LlmSettingsSchema`, optional)
  - `avatar_path` (nullable), `color` (hex for the UI), `archived_at`, `created_at`, `updated_at`
- `platform_accounts`
  - `id`, `profile_id` (FK, cascade on delete), `platform` (`youtube` | `tiktok` | `facebook_reels` | `instagram_reels`), `display_name`, `handle` (nullable)
  - `format`: `landscape` (16:9) | `vertical` (9:16). Default `landscape` for youtube, `vertical` for the others. A YouTube Shorts account is `youtube` + `vertical`.
  - `enabled` (bool), `connection` (`NOT_CONNECTED` | `CONNECTED` | `EXPIRED` | `ERROR`), `connection_error` (nullable)
  - `publish_settings` (JSON): `visibility` (`public` | `unlisted` | `private`, default `public`), `autoPublish` (bool, default **false**), `categoryId`/`defaultTags`/`playlistId` (optional, platform-specific, stored as a loose JSON object)
  - `created_at`, `updated_at`
- `projects`: add a nullable `profile_id` column. Old projects stay without a profile.

Put the zod schemas in a new `packages/shared/src/schemas/profile.ts` (`ProfileSchema`, `ProfileInputSchema`, `PlatformAccountSchema`, `PlatformAccountInputSchema`, `PlatformIdSchema`, `AccountFormatSchema`). Export them from the shared index.

## Behaviour
- **New project from a profile:** `POST /api/projects` accepts `profileId`. The project's settings start from the profile's `default_brief`, `language`, `voice`, `guidelines` and `llm`. Values the user sets in the request win. The aspect ratio comes from the profile's **main format** (`landscape` if the profile has any landscape account, else `vertical`; with no account, the brief's own value).
- **The profile's direction reaches the LLM.** Wherever the brief/topic is put into prompts (research, script, metadata, sceneQueries), add a short "Định hướng kênh" block with the profile's `direction` when the project has a profile. Keep it under about 800 characters (truncate in code). With no profile, prompts are unchanged. Tests check that the mock LLM request contains the direction.
- **Changing a profile later** does not rewrite existing projects.
- **Archiving** a profile hides it from lists; its projects keep their `profile_id`.

## API (`apps/server/src/api/profiles.ts`)
| Method | Path | |
|---|---|---|
| GET | `/api/profiles` | list with account counts and project counts |
| POST | `/api/profiles` | create |
| GET | `/api/profiles/:id` | profile + accounts |
| PATCH | `/api/profiles/:id` | update |
| POST | `/api/profiles/:id/archive` | archive (and `/unarchive`) |
| POST | `/api/profiles/:id/accounts` | add an account |
| PATCH | `/api/profiles/:id/accounts/:accountId` | update |
| DELETE | `/api/profiles/:id/accounts/:accountId` | remove (only allowed while `NOT_CONNECTED`; else 409) |
| GET | `/api/projects?profileId=` | filter projects by profile |

## Web (`apps/web/src/features/profiles/`)
- A **"Hồ sơ"** entry in the main navigation, with a list page (cards: color dot, name, accounts as platform icons/labels, project count).
- A profile page with tabs:
  - **"Định hướng"**: name, description, direction (large textarea), language, color;
  - **"Brief mặc định"**: reuse `BriefFields` for the default brief, voice and guideline pack;
  - **"Tài khoản"**: list and add/edit accounts (platform, display name, handle, format, visibility, auto-publish toggle). Show the connection state as a badge ("Chưa kết nối"). The connect button comes in TASK-024; leave a disabled placeholder.
  - **"Dự án"**: the profile's projects.
- The new-project form gets a **"Hồ sơ"** select at the top. Picking one fills the form from the profile.
- The project list shows a small profile chip per project and a profile filter.

## MCP
Add `list_profiles` and `create_project` accepting `profileId` in `apps/mcp/src/tools.ts`.

## Tests (no network)
- Shared: schema defaults (format by platform, `autoPublish` false).
- Server: CRUD routes; project creation from a profile (settings inherited, request overrides win, aspect ratio from the main format); direction block in the script prompt (mock); account delete rule; archive.
- Web: profile list renders; the new-project form fills from a profile.

## Steps
1. Shared schemas and tests.
2. Server: tables + drizzle generate, repository, routes, project creation, prompt direction, tests.
3. Web pages + tests. MCP tools.
4. Run the README done checklist (browser check on a throwaway profile). Write `docs/tasks/TASK-022.report.md` and `docs/tasks/TASK-022.done`.
