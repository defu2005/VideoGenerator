# TASK-048: Cursor guide (the user guide: written now, kept up to date by every later task)

Before you start, read `docs/cursor/README.md`, `docs/ARCHITECTURE.md`, and the specs and reports of the tasks already done (`docs/tasks/*.report.md`). You will describe what they built.

No new npm dependencies. Tests never use the network.

## Why

The app has grown to dozens of features: profiles, pipeline, gates, renders, publishing, analytics, finance, comments, trends, quota, the assistant, Telegram and more. There is no guide for the user. Write one in Vietnamese, and make sure it **cannot go stale**:
- every later task must update it, as part of the README done checklist;
- a test fails when a feature or a page has no guide section.

## 1. One feature map in code (single source of truth)

Write `packages/shared/src/features/featureMap.ts`, a typed array of features:

```ts
{
  key: "topic-queue",            // stable id
  nameVi: "Hàng đợi chủ đề",
  areaVi: "Tự động hoá",
  summaryVi: "…one sentence…",
  webRoutes: ["/profiles/:id/automation"],
  docPage: "docs/user-guide/tu-dong-hoa.md",
  docAnchor: "hang-doi-chu-de",
  sinceTask: "TASK-028",
  settingsKeys?: string[],
}
```

- Cover **every** user-visible feature built so far, from the reports in `docs/tasks/`.
- TASK-047 (the operator handbook feature map) will reuse this array. Export it from `@vg/shared`.

## 2. The guide (`docs/user-guide/`, Vietnamese, Markdown)

Write the guide for a non-developer, in short sections with numbered steps. Name the real button and tab labels exactly as they appear in the UI (read them from the components).

**Files**
- `README.md`: a table of contents, plus "Bắt đầu nhanh trong 10 phút":
  1. create a profile;
  2. add a topic;
  3. run a project to render;
  4. publish.
- `cai-dat.md`, which covers:
  - starting the app;
  - the AI model setup (OmniRoute, routes, quota);
  - connecting Telegram;
  - connecting platforms with OAuth.
  - The user always enters keys and tokens themselves. Never show real values; use placeholders such as `<token của bạn>`.
- **One file per area**, for example:
  - `ho-so.md`
  - `du-an-va-quy-trinh.md` (stages, gates, MANUAL/ASSISTED/AUTO modes, review chat)
  - `hinh-anh-va-giong-doc.md`
  - `render-va-thumbnail.md`
  - `dang-bai.md`
  - `tu-dong-hoa.md` (topic queue, trends, scheduler, translations, clips)
  - `phan-tich-va-tai-chinh.md`
  - `binh-luan.md`
  - `mo-hinh-ai.md` (routes, advisor, quota, OmniRoute live quota)
  - `tro-ly-va-telegram.md`
  - `che-do-ngan-sach.md`
- `an-toan.md`. It lists:
  - what always needs the user's approval;
  - what the app never does on its own (paid spend, public uploads without approval, credentials);
  - the protected-project rule, phrased for the user.
- `xu-ly-su-co.md`: the common errors and what to do. Take them from the real Vietnamese error messages in the code: `LLM_QUOTA_WAIT`, `needs_token`, TTS failures, render failures, OAuth expiry.
- `thuat-ngu.md`: a glossary (gate, stage, route, fallback, quota, combo, operator…).
- `nhat-ky-thay-doi.md`: a changelog, newest first, one entry per task: `## TASK-0XX — <ngày>`, then 2–5 bullets in plain Vietnamese about what changed for the user.

**Rules for every section**
- Each feature section has an anchor matching `docAnchor`.
- Each section covers:
  - what the feature is for, in one or two sentences;
  - where to find it (menu → tab);
  - the steps;
  - the settings and their defaults;
  - its limits and what needs approval.
- Screenshots are optional. If you add them, take them only from the test project or test profile, store them under `docs/user-guide/img/`, and make sure they contain no personal data, tokens or emails.

## 3. In-app help

- **A "Hướng dẫn" page** (`/help`, in the sidebar near the bottom).
  - It renders the guide files, which the server serves read-only from `docs/user-guide/` through `GET /api/help/:page` (a whitelist of file names, no path traversal).
  - Write a small Markdown renderer for headings, lists, tables, code, links, images and bold/italic. React escapes text; do not use `dangerouslySetInnerHTML` on raw Markdown.
  - Add a search box over the section titles and text.
- **A contextual "?" link** in the header of every page or tab listed in `featureMap.webRoutes`. It opens `/help/<page>#<anchor>`.
- **A read tool `search_user_guide(query)`** for the assistant (and MCP). It returns the best-matching sections with their text. TASK-047 will move it into the shared registry, and the operator will use it to answer "làm sao để…?" questions.

## 4. Keeping it up to date (the "auto update")

1. **README rule.** Add this item to the done checklist:

   > The user guide is updated for every user-visible change: the `featureMap` entry, the guide section, and a `nhat-ky-thay-doi.md` entry for this task.

   Also add this line to the README rules: "Every task that changes what the user sees or does must update `docs/user-guide/`."

2. **Coverage test** (`apps/web/src/features/help/guideCoverage.test.ts` or a shared test). It fails when:
   - a `<Route path>` in `App.tsx` (except redirects and `*`) is not covered by some `featureMap.webRoutes`;
   - a feature's `docPage` file is missing, or its `docAnchor` heading is missing;
   - a guide link points to a missing file or anchor;
   - a guide file contains something that looks like a secret (`sk-`, `oma_`, `Bearer `, emails, long hex or base64 tokens) or broken UTF-8;
   - the newest `docs/tasks/*.done` task id has no changelog entry. This makes every finished task add one.

3. **Profile tab and settings coverage.** Also cover each profile tab and project tab key, read from the tab lists in their components, so new tabs need a guide section too.

## 5. Tests

- The coverage test above.
- The help API serves only whitelisted files, and refuses `../`.
- The Markdown renderer handles the listed elements, and escapes HTML.
- The "?" link resolves for every route in the feature map.
- `search_user_guide` ranks a matching section first.

## 6. Live check

1. Open `/help`. Read "Bắt đầu nhanh", search "quota", and open the "?" link from the AI models page and from a profile's automation tab.
2. Ask the assistant: "làm sao để kết nối Telegram?". The answer should cite the guide.
3. Use only the test profile `e6c2f6f3-3e6f-434d-94ae-77d7f4c912f0` and the test project `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` for any screenshot. Never touch `56374fb2-54cf-48ff-9441-2e6c653295d4`.
4. Attach screenshots.

## Done

Use the done checklist from the README (including the new user-guide item). Write `docs/tasks/TASK-048.report.md` and `docs/tasks/TASK-048.done`.
