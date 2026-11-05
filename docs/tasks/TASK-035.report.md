# TASK-035 report — Learn from results

## What changed

### Shared (`packages/shared`)
- `src/schemas/learning.ts` — learning mode, insight output, view, apply/dismiss bodies, “Chưa đủ dữ liệu”
- `src/schemas/llm.ts` — `performanceInsight` (SETTINGS, strong, budget feature)
- `src/budget/modes.ts` — `performanceInsight: true` on ECO, BALANCED, QUALITY, MAX
- `src/schemas/profile.ts` — `appendChannelDirection` takes learned notes (“Bài học từ số liệu”, max 600)
- `src/schemas/analytics.ts` — optional `score` on video rank items
- `src/publishing/youtubeHelp.ts` — A/B needs the full YouTube scope
- `src/index.ts` — export learning schemas
- Tests: `test/budget.test.ts`, `test/llm.test.ts`, `test/profile.test.ts`

### Server DB
- `src/db/schema.ts` — profile columns `learning_mode`, `learned_notes`, `learned_hints`, `title_ab_test`, `learning_undo`; tables `profile_insights`, `title_experiments`
- Migration `drizzle/0030_task_035_learning.sql` (+ snapshot). Second `drizzle-kit generate` printed “No schema changes, nothing to migrate”.

### Server learning
- `src/learning/features.ts` — feature rows, per-platform percentile score, hour/duration/topic stats, recommendation clamp, Monday 08:00 schedule, title-switch rule
- `src/learning/loadRows.ts` — load published videos, snapshots, profit from stored revenue/cost rows
- `src/learning/learningService.ts` — view, settings, manual/weekly run, suggest vs auto apply, undo, title A/B tick
- `src/api/learning.ts` — `/api/profiles/:id/learning` and insight apply/dismiss

### Wiring
- `src/app.ts` — LearningService, routes, YouTube title update
- `src/publishing/ticker.ts` — weekly tick
- `src/publishing/youtubePublisher.ts` — `videos.update` title change
- `src/providers/llm/mock.ts` — PerformanceInsight fixture; topic-suggest JSON stays parseable when a direction block follows it
- `src/assistant/tools.ts` + `service.ts` — `profile_insights` (read), `run_insight` (safe), `apply_insight` (confirm)
- `src/services/profileService.ts` — prompt context (direction, learned notes, topic angles, avoid, title A/B)
- `src/services/topicService.ts`, `src/stages/script/prompt.ts`, `mergedStoryPrompt.ts`, `scriptExecutor.ts`, `researchExecutor.ts`, `src/api/script.ts` — inject learned notes
- `src/services/metadataService.ts`, `src/stages/timeline/metadataPrompt.ts` — two titles when A/B is on; learned notes in the prompt
- `src/analytics/overview.ts` — attach score when the profile has at least 8 scored videos

### Web
- `src/features/profiles/InsightsTab.tsx` + `InsightsTab.test.tsx` — tab “Bài học”
- `src/features/profiles/ProfileDetailPage.tsx` — tab route
- `src/services/learningApi.ts`, `src/hooks/useLearning.ts`
- `src/features/analytics/AnalyticsPage.tsx` + test — column “Điểm”
- `src/features/projects/BriefFields.tsx` — CUSTOM toggle “Bài học hiệu suất từ số liệu”
- `ProjectDetailPage.test.tsx` — budget fixture

### Tests
- `apps/server/test/learning.test.ts` — snapshots, percentile, &lt;8 videos, recommendation clamp, suggest/auto/undo, prompts, schedule, rate limit, title switch, missing scope
- `apps/server/test/youtubePublisher.test.ts` — `videos.update` keeps snippet fields

## Test counts

| Workspace | Tests |
|---|---|
| shared | 208 |
| mcp | 12 |
| server | 542 |
| web | 105 |

`npm run typecheck`, `npm run build`, and `npm test` all pass. No `package.json` or lockfile change. No NUL bytes in the changed files.

## Deviations from the guide

1. **autoPublish** is read from enabled accounts’ `publishSettings.autoPublish`. Profile automation has no such flag. Auto mode writes `publishTimes` only when at least one enabled account has it on.
2. **ECO** keeps `performanceInsight` on so the job can run. The 14-day floor applies to the Monday scheduler only. The manual button stays once per hour.
3. **Profit** uses stored `revenue_entries` and `cost_entries` (including allocated channel revenue). Live LLM usage costs are not copied into that table.
4. **Learned notes** are appended at prompt time, same as channel direction. They are not part of `scriptInputHash`.
5. **A/B scope** is not added to every YouTube OAuth request. Without `https://www.googleapis.com/auth/youtube`, the toggle is hidden and the API rejects turning it on. The playlist connect path already asks for that scope.
6. **Weekly catch-up** runs only on Monday at or after 08:00 in the profile timezone. If the process is down all Monday, the next chance is the following Monday (ECO still needs 14 days and 3 new scored videos).
7. **Browser** tools were not available in this session, so the tab was not clicked in a live throwaway project. Web tests cover the “Bài học” tab (apply + “Phân tích ngay”) and the analytics “Điểm” column.

## Not done

- Live browser pass on a throwaway project (see deviation 7). Project `56374fb2-54cf-48ff-9441-2e6c653295d4` was not opened, approved, or rendered.
