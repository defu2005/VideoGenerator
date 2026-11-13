# TASK-098b — Multi-episode series 📺

**Who:** a new Sonnet 5.5 session (or Codex when the user asks). **Size:** L. **Migration:** yes (`series`, `seriesId?`/`episodeNo?` on topics and projects); drizzle-kit only (🗄). **New dependency:** none.
**Depends on:** TASK-098a, and RESEARCH-086 (`docs/research/api-capabilities/youtube.md`).

## Why

Series make binge sessions and returning viewers. Today each video stands alone: no arc, no "tập trước / tập sau", no playlist.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 `series`, §4 group `strategy` (`plan_series`: confirm, grant `topics`).
- `docs/research/api-capabilities/youtube.md`:
  - playlists can be created, added to and ordered via the API (50 quota units per call);
  - **end screens, cards and pinned comments have no API**. They become "Cần bạn" requests that the user does in Studio.
- The topic queue (`profile_topics`), the scheduler, and the publish flow.

## Build

1. **Tables:**
   - `series`: profile, title, arc (an ordered list of episode briefs), status, `playlistExternalId`;
   - topics and projects get `seriesId?` and `episodeNo?`.
2. **`plan_series(profileId, theme, episodes)`** (confirm, grant `topics`): the LLM writes the arc (an episode list with a promise each, with continuity notes) and creates topics in order. ECO mode makes an outline from a template, with no LLM call.
3. **Continuity.** The script prompt for episode N gets the arc, the summary of episodes 1..N-1 (from the published scripts) and an "ở tập sau" teaser line for N+1.
4. **Publishing.**
   - On the first publish, create the playlist; add each episode in order, with the quota logged.
   - The description gets links to the previous and next episodes; when the next one is published, update the previous description (`update_packaging`-style confirm, or within a grant).
   - Make a "Cần bạn" request for the end screen and card per episode.
5. **Stats:** `get_series_stats(seriesId)`: read; episode-to-episode retention of viewers (where the API allows), views per episode, and drop-off.
6. **Web.** A "Series" page per profile: the arc, episode status, playlist link and stats.

## Mã nguồn mở có sẵn (open source)

- The official **YouTube Data API** playlist samples (Apache-2.0).

## Rules

README rules 1–11. Never publish an episode out of order without the user's OK. A series limit per channel (a user setting) is enforced.

## Tests

- plan creates ordered topics;
- ECO outline;
- the continuity prompt;
- playlist create and add (mocked, with quota logged);
- the description link update;
- "Cần bạn" requests;
- stats `insufficient_data`.

## Done

- [ ] tables + plan_series + continuity + publishing hooks + stats
- [ ] page; tools; skill (`video-lich-san-xuat` or `video-chien-luoc-kenh`)
- [ ] tests; suites; migration
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-098b.done`
