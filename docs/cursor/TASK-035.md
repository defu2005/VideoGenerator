# TASK-035 — Cursor guide (learn from results)

Read `docs/cursor/README.md`, `TASK-033.md` and `TASK-034.md` first (both are committed). This task closes the loop: it uses the analytics (and the profit, when present) of past videos to improve future ones. It does this per profile:
- what topics, hooks, lengths and posting times work;
- feeding that into topic suggestions, scripts and the schedule.

The user's direction text stays theirs. The app proposes changes, and only applies them automatically when the profile allows it.

No new npm dependencies.

## 1. Feature table (pure code, no LLM)
`apps/server/src/learning/features.ts` builds one row per PUBLISHED publication that has metrics older than 72 h.
- **Content features:**
  - topic title;
  - the script's first sentence (the hook);
  - duration;
  - scene count;
  - voice;
  - music on/off;
  - aspect;
  - the language;
  - the template/preset if any;
  - posting weekday + hour in the profile timezone;
  - title length;
  - hashtag count.
- **Outcome features:**
  - views at 72 h (the snapshot closest to 72 h after publish) and at 7 d;
  - avg view % ;
  - likes/comments/shares per 1k views;
  - followers gained;
  - profit (TASK-034) when present.
- **Score:** a per-profile, per-platform normalized score from 0 to 100: a percentile rank of views at 7 d (weight 0.5), avg view % (0.3) and engagement per 1k (0.2). Platforms are ranked separately, because their view scales differ.
- Profiles with fewer than 8 scored videos get "Chưa đủ dữ liệu". Every later step is skipped for them, with that message.

## 2. Insights (LLM, new task `performanceInsight`)
- Add `performanceInsight` to `LLM_TASKS` (stage SETTINGS, tier strong, budget feature, mock answer). Follow how `modelAdvisor` was added.
- Input:
  - the top 25% and bottom 25% rows (hook, title, duration, posting time, score);
  - the profile direction;
  - simple stats computed in code: the best posting hours (median score per hour bucket, only buckets with ≥ 3 videos), the score by duration bucket, and the score by topic cluster. Cluster by keyword overlap in code; no embeddings.
- Output, zod-validated:
  ```ts
  { summary: string,                         // Vietnamese, ≤ 5 bullets
    patterns: { kind: "topic"|"hook"|"length"|"timing"|"format", finding: string, evidence: string, confidence: "low"|"medium"|"high" }[],
    recommendations: {
      directionAddendum?: string,            // ≤ 600 chars, appended as "Bài học từ số liệu" block
      preferredDurationSec?: { min: number, max: number },
      publishTimes?: string[],               // "HH:mm", only hours backed by data
      topicAngles?: string[],                // ≤ 8 short angles to favour
      avoid?: string[]                        // ≤ 5
    } }
  ```
- In code, reject recommendations that are not backed by the stats:
  - `publishTimes` must come from buckets with ≥ 3 videos and above-median scores;
  - the duration range must overlap the observed range.

## 3. Applying insights
Add a per-profile setting `learningMode: "off" | "suggest" | "auto"` (default "suggest").
- **suggest:** store the insight as `profile_insights` (id, profile_id, created_at, period, json, status `new` | `applied` | `dismissed`). It shows on the profile page with "Áp dụng" buttons per recommendation. Applying writes:
  - the directionAddendum into a separate profile field `learnedNotes` (never overwriting `direction`);
  - publishTimes into the automation settings;
  - the duration into the default brief.
- **auto:** apply immediately, but only `learnedNotes`, `topicAngles` and the duration. Do not apply `publishTimes` automatically unless automation `autoPublish` is on. Every auto-apply is logged in `automation_log` and sent as one Telegram `attention`-level info ("Đã cập nhật bài học cho hồ sơ …").
- Each apply keeps the previous values, so the profile page can "Hoàn tác" the last apply.
- `learnedNotes` is injected into prompts next to the channel direction:
  - topic suggest;
  - script;
  - metadata/title.
  Use the `appendChannelDirection` helper with a separate "Bài học từ số liệu" block, truncated to 600 chars.
- `topicAngles` and `avoid` feed `topicSuggest` (TASK-028).

## 4. Schedule
- Weekly per profile (Monday 08:00 profile time), when there are ≥ 3 new scored videos since the last insight.
- A manual "Phân tích ngay" button on the profile page, rate limited to once per hour.
- Respect the budget mode. In the "economy" mode, run at most every 2 weeks.

## 5. A/B title testing (light)
For YouTube only, as an optional per-profile toggle "Thử 2 tiêu đề":
- the metadata step produces 2 titles;
- the publish uses title A;
- after 48 h, if views per hour are below the profile median, switch to title B via `videos.update`;
- record which won.

This needs the full YouTube scope. When it is not granted, hide the toggle and explain. The result feeds the next insight as a "hook/title" pattern.

## 6. UI and assistant
- Profile page, new tab "Bài học":
  - the latest insight, the patterns with evidence, the recommendation cards with apply/dismiss;
  - the history;
  - the `learningMode` select;
  - the A/B toggle.
- The analytics page (TASK-033) shows "Điểm" (score) in the video table.
- **Assistant tools:**
  - read: `profile_insights`;
  - safe: `run_insight`;
  - confirm: `apply_insight`.

## 7. Tests (mock LLM, fake clock)
- The feature builder picks the 72 h and 7 d snapshots correctly; the percentile score is per platform.
- Fewer than 8 videos → no LLM call.
- Recommendation validation drops publishTimes without data support and clamps the duration.
- suggest mode stores without applying. auto mode applies only the allowed fields and logs plus notifies. Undo restores the previous values.
- `learnedNotes` appears in the topic/script prompt, and `direction` is unchanged.
- The weekly schedule and the manual rate limit.
- A/B: switching happens only below the median after 48 h, never twice. A missing scope hides the feature.

## Done
Done checklist from the README. Write `docs/tasks/TASK-035.report.md` and `docs/tasks/TASK-035.done`.
