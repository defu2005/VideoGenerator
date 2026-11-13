# TASK-103 — Purpose-written Shorts + the Short → long funnel 🔁🔴

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** yes (`projects.derivedKind`, if 101 has not added it, plus a Short↔long link); drizzle-kit only (🗄). **New dependency:** none.
**Depends on:** TASK-087.

## Why

Cutting a clip from a long video makes a weak Short. A Short written for the format (a hook in 1 s, one idea, a loop or a cliffhanger) that points to the long video can feed it. We cannot measure that funnel today.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 (`projects.sourceProjectId`, `derivedKind`), §4 `derive_asset` (confirm, grant `null`), `get_funnel_stats` (read).
- `docs/research/api-capabilities/youtube.md`:
  - the related video link on Shorts: check whether it is settable via the API. If it is not, it becomes a "Cần bạn" request;
  - the traffic source report "SHORTS" for long videos.
- The 9:16 compose path and the recipe for Shorts.

## Build

1. **`derive_asset(projectId, kind: "short")`** creates a new project with `sourceProjectId` and `derivedKind: "short"`.
   - The script is **rewritten** for Shorts from the source's best segment (the retention map, 089, if there is one; otherwise the LLM picks): ≤ 45 s, a hook in the first sentence, one idea, and an end that points to the long video.
   - The source's visuals and voice may be reused, but the edit is native 9:16.
2. **Link.** After both are published, store the pair. If the API allows setting the related video, set it; otherwise make a "Cần bạn" request.
3. **Funnel stats.** `get_funnel_stats(longPublicationId)`: the Short's views and the long video's views from the SHORTS traffic source (Analytics `insightTrafficSourceType`), per window. Without the data, return `insufficient_data`.
4. **Web.** A "Tạo Short" button on a published project, and the funnel numbers on the publication page.

## Mã nguồn mở có sẵn (open source)

- **auto-editor** (Unlicense) and the **OpusClip** idea (closed) are references for picking segments. We use our own retention map; nothing to copy.

## Rules

README rules 1–11. A derived Short passes originality and sameness (113) against its source like any video. Never on the protected project.

## Tests

- derive creates the linked project;
- the Short script constraints (length, hook, CTA);
- the pair link and "Cần bạn" fallback;
- funnel stats from a fixture and `insufficient_data`.

## Done

- [ ] derive + link + funnel stats
- [ ] UI; tools; skill (`video-render-va-thumbnail` or `video-dang-bai`)
- [ ] tests; suites; migration
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-103.done`
