# TASK-049: Cursor guide (frontend polish: navigation, design system, states, responsive, speed)

Read `docs/cursor/README.md` first. **This task runs in a separate git worktree on branch `frontend-polish`**, while another Cursor session changes the server and shared code on `master`. The two branches will be merged later, so follow the scope rules strictly.

No new npm dependencies. Tailwind, React Router and TanStack Query are already there. Tests never use the network.

## Scope (to keep the merge clean)

- **Only `apps/web/`.** Do not change `apps/server`, `apps/mcp`, `packages/shared` or any API contract. If the UI needs data that the API does not give, write it under "Đề xuất API" in the report instead.
- **No behaviour changes.** The same actions call the same endpoints with the same payloads. Only the look, layout, wording consistency, states, accessibility and speed change.
- **Keep the tests.** All existing web tests must pass. If a test depends on a label you renamed, keep the old label, or update the test and list it in the report. Prefer keeping labels.
- **Small, separable commits of work.** Group the changes by area, so that a merge conflict touches as few files as possible. Do not mass-reformat files you do not otherwise change.

## 1. Audit first (write it to `docs/tasks/TASK-049.audit.md`)

Read every page and tab under `apps/web/src/features/**` and `components/layout/**`. For each one, list:
- inconsistencies: buttons, spacing, headings, cards, tables, colours, chip styles;
- missing loading, empty and error states;
- long pages without structure;
- forms without validation feedback;
- pages that break under 768 px wide;
- accessibility gaps: labels, focus, contrast, keyboard use, the `aria` on icon buttons;
- slow spots: large lists without paging or virtualisation, refetch storms, bundle weight.

Rank the findings by user impact, then fix them in that order.

## 2. Design system (small, in `apps/web/src/components/ui/`)

- **Tokens.** Tailwind theme tokens in `tailwind.config` for the colours (primary, neutral, success, warning, danger, info), radius, shadow and spacing scale. Use them everywhere instead of ad-hoc colour classes.
- **Shared components.** Build these, and use them in place of the duplicated markup:
  - `Button` (primary / secondary / ghost / danger, sizes, loading state);
  - `Card`, `PageHeader` (title, description, actions, and room for a "?" help link that TASK-048 will fill);
  - `Tabs`, `Badge`/`Chip` (status colours in one map);
  - `Table` (sticky header, empty row, paging), `Field` (label, hint, error), `Select`, `Toggle`;
  - `Modal`, `Toast` (one toast system for success and error feedback), `Skeleton`, `Tooltip`;
  - `KpiCard` and a simple `ProgressBar`, both used by quota, usage and finance.
- **Existing components.** Keep `EmptyState`, `ErrorState`, `Spinner`, `StatusBadge` and `ConfirmDialog`, but restyle them on the tokens.
- **Gallery page.** Add a dev-only route `/dev/ui` that shows every component, so the next tasks reuse them. Do not show it in the sidebar.

## 3. Navigation and layout

- **Sidebar.** Group the sidebar into sections, roughly:
  - **Tổng quan**: dashboard, Trợ lý AI;
  - **Nội dung**: Hồ sơ, Dự án, Lịch đăng, Bình luận;
  - **Kết quả**: Phân tích, Tài chính, Usage;
  - **Cài đặt**: AI, render, image sources, web image, notifications, guidelines.

  Each section can collapse, and the active state is clear.
- **Mobile.** Under 768 px, the sidebar becomes a drawer with a top bar.
- **Breadcrumbs.** Show them on detail pages, for example Hồ sơ › Tên hồ sơ › Tự động hoá.
- **Command palette.** `Ctrl+K` opens a quick switcher to search pages, profiles and projects. It uses existing list endpoints only.
- **Project detail.** Show a clear stage stepper with the current stage, the gate status and the next action in one sticky header.

## 4. States and feedback

- **Every query** has a skeleton while loading, an empty state with the next action, and an error state with "Thử lại".
- **Every mutation** shows loading on its button, a toast on success or error, and disables double-submit.
- **Destructive actions** use `ConfirmDialog` with a clear Vietnamese consequence text.
- **Long-running jobs** (render, TTS, sync) show progress and elapsed time where the API already reports them.
- **Relative times** ("3 phút trước") come from one shared helper, with a tooltip showing the full local time.

## 5. Dashboard

Keep the data the dashboard already loads, but lay it out as:
- a KPI row;
- "Cần bạn xử lý": pending gates, pending approvals, failed jobs, `needs_token`, expiring OAuth;
- "Sắp đăng": the next scheduled publishes;
- "Xu hướng hôm nay";
- recent projects.

Each item links to where it is handled.

## 6. Speed

- **Lazy-load pages.** Use `React.lazy` with route-level code splitting, plus a page skeleton as the fallback.
- **TanStack Query defaults.** Set a sensible `staleTime` and no refetch-on-focus storms. Keep the polling intervals that already exist, but pause them while the tab is hidden.
- **Long lists.** Use paging or "Tải thêm" on lists that can grow large: comments, jobs, topics, analytics rows.
- **Bundle report.** In the report, give the build output sizes before and after.

## 7. Accessibility and language

- Every input has a label.
- Icon-only buttons have an `aria-label`.
- The focus ring is visible.
- Dialogs trap focus and close on Esc.
- Colour contrast is at least AA.
- **Language.** All UI text is Vietnamese and consistent (one term per concept; reuse the glossary words). Write dates as `dd/MM/yyyy HH:mm`, and money in `$` with 2 decimals, or VND with grouping where the API gives VND.

## 8. Tests

- **Unit tests** for the new UI components: the variants, the loading button, the Field error, the Table empty row, Tabs keyboard navigation, Modal Esc and focus.
- **Layout tests:**
  - the sidebar sections render;
  - the drawer opens under 768 px (set `window.innerWidth` and `matchMedia` in jsdom);
  - the command palette finds a page.
- **Existing tests:** all of them still pass.

## 9. Live check

- **Setup.** In this worktree, run only the web dev server, on port **5181**: `npm run dev -w apps/web -- --port 5181`. It proxies `/api` to the API already running on `127.0.0.1:3001` from the main checkout. Do not start another API server, and do not create or touch `data/` or `.env` in the worktree.
- **What to check.** Open each main page at 1280 px and 390 px wide.
- **Test data.** Use only the test profile `e6c2f6f3-3e6f-434d-94ae-77d7f4c912f0` and the test project `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` for any action.
- **Forbidden.** Do not approve gates, render, publish, or change settings. **Never touch `56374fb2-54cf-48ff-9441-2e6c653295d4`.**
- **Screenshots** go in the report, before and after for the dashboard, project detail and settings.

## Done

- Use the done checklist from the README.
- Also write `docs/tasks/TASK-049.audit.md`, `docs/tasks/TASK-049.report.md` (with an "Đề xuất API" section if needed) and `docs/tasks/TASK-049.done`.
- Do not commit. The reviewer commits on branch `frontend-polish` and merges.
