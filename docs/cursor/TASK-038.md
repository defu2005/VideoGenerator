# TASK-038 — Cursor guide (comment inbox across platforms)

Read `docs/cursor/README.md` and `TASK-033.md` first. This task builds one inbox for comments on the user's own published videos:
- reply suggestions from the LLM;
- a spam/toxicity filter;
- optional auto-replies within strict limits.

Only official APIs and only the user's own content.

No new npm dependencies.

## 1. What each platform allows
- **YouTube:**
  - `commentThreads.list?videoId=…&part=snippet,replies&order=time` reads comments;
  - `comments.insert` (with `parentId`) replies;
  - `comments.setModerationStatus` holds or rejects (the video owner only);
  - `comments.markAsSpam`.
  - Scope: `https://www.googleapis.com/auth/youtube.force-ssl`. This is an opt-in per account ("Quản lý bình luận YouTube"), triggering a reconnect like TASK-033/034.
  - Quota: list = 1 unit, insert = 50 units. Use the existing `youtubeQuota` and stop replies when < 20% of the daily quota is left.
- **Instagram:**
  - `GET /{ig-media-id}/comments` (fields: id, text, username, timestamp, like_count, replies);
  - `POST /{ig-comment-id}/replies`;
  - `POST /{ig-comment-id}?hide=true`;
  - `DELETE /{ig-comment-id}` (own media only).
  - Scope: `instagram_manage_comments`.
- **Facebook Page videos/reels:**
  - `GET /{object-id}/comments`;
  - `POST /{comment-id}/comments` to reply;
  - `POST /{comment-id}?is_hidden=true`.
  - Scopes: `pages_read_user_content`, `pages_manage_engagement`.
- **TikTok:** the public Content Posting/Display APIs do not offer comment read or reply for this app type. Show the TikTok accounts with "TikTok chưa hỗ trợ đọc bình luận qua API" and a link that opens the video. No scraping.

Add the scopes to the scope lists and help texts. Accounts without them get `needs_reconnect` for the comments feature only.

## 2. Data model (drizzle-kit generate)
`comments`:
- id, publication_id (FK), platform, external_id (unique per platform), parent_external_id;
- author_name, author_external_id, text, like_count, published_at, fetched_at;
- `status`: `new` | `read` | `replied` | `hidden` | `spam` | `ignored`;
- `classification`: `question` | `praise` | `complaint` | `request` | `spam` | `toxic` | `other` | null;
- `priority` (0–100), `suggested_reply` (nullable), `reply_external_id`, `replied_at`, `replied_by` (`user` | `auto`).

Never store author emails or anything beyond what the API returns for display.

## 3. Sync
- Uses the same ticker as TASK-033. Poll publications by age:
  - < 3 days: every 30 min;
  - < 30 days: every 6 h;
  - older: daily.
- Only new comments (since the last fetch time / page token) are fetched.
- Rate limits and backoff follow TASK-033.

## 4. Classification and reply suggestions (LLM task `commentAssist`, tier fast, budget feature)
- Batch up to 20 new comments per call. Input: the video title, the script summary (≤ 800 chars), the profile direction, and a reply style setting:
  - tone: `thân thiện` / `chuyên nghiệp` / `hài hước`;
  - emoji yes/no;
  - signature.
- Output per comment: classification, priority, toxic boolean, suggested reply. The reply is ≤ 300 chars, in the comment's language, never promising things, and gives no medical/legal/financial advice.
- In code, before the LLM: a quick spam pre-filter catches links, phone numbers, repeated characters, known spam phrases (a list in settings, editable) and duplicate text from the same author. A comment marked spam in code is not sent to the LLM.

## 5. Actions and the auto-reply policy
- Manual actions in the inbox:
  - reply (edit the suggestion first);
  - hide;
  - mark spam (YouTube only);
  - ignore;
  - mark read.
  - Deleting is only offered on Instagram, behind a confirm dialog.
- A per-profile `commentAutomation` setting has three modes:
  - **`off`** (default).
  - **`hide_spam`:** spam and toxic comments are hidden automatically. Everything is logged and reversible ("Bỏ ẩn").
  - **`auto_reply`:** also auto-replies to `praise` and simple `question` with confidence high, with these limits:
    - at most N replies per video per day (default 10) and M per account per day (default 30);
    - at most 1 reply per author per video;
    - no replies to comments older than 7 days;
    - never replies to `complaint`, `request` or `toxic`;
    - the replies vary (no identical text twice on the same video).
    - These limits keep the activity natural and within platform rules. They are not detection evasion: the replies are real and the account owner enabled them.
- Every auto action is written to `automation_log`. High-priority comments (complaints, questions with priority ≥ 70) send a Telegram `attention` notification (TASK-031) batched hourly: "3 bình luận cần trả lời".

## 6. UI
- A new sidebar page "Bình luận" (`/comments`):
  - filters: profile, platform, status, classification;
  - a list sorted by priority then time;
  - each item shows the video thumbnail and title, the author, the text, the classification badge, and the suggested reply in an editable box with "Gửi", "Ẩn", "Spam", "Bỏ qua";
  - bulk actions for spam;
  - an unread badge in the sidebar.
- The profile settings get a "Bình luận" section: automation mode, limits, tone/emoji/signature, and the spam phrase list.
- **Assistant tools:**
  - read: `list_comments`;
  - confirm: `reply_comment`, `hide_comment`.

## 7. Tests (mock fetch, mock LLM)
- The YouTube, IG and FB fetchers map comments and paginate. Incremental sync fetches only new ones.
- The spam pre-filter catches links, phones, repeats and duplicates without an LLM call.
- `commentAssist` batching by 20; a classification is stored.
- Auto-reply limits:
  - per video, per account, per author;
  - the age limit;
  - never for complaint/toxic;
  - no duplicate text.
- The YouTube quota floor stops replies.
- Missing scopes → needs_reconnect, no calls.
- TikTok shows the unsupported note.
- Web: replying sends the edited text, and the bulk spam action works.

## Done
Done checklist from the README. Write `docs/tasks/TASK-038.report.md` and `docs/tasks/TASK-038.done`.
