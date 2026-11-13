# TASK-100 — The audience asks, the channel answers 💬🔴

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** S. **Migration:** probably none (topics carry a source); if needed, drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-082 (real comments).

## Why

Viewer questions in the comments are the best topic source: proven demand, and replying builds loyalty. The comment inbox exists, but questions are not collected.

## Read first

- `apps/server/src/comments/{inboxService,youtubeFetcher}.ts` and the `video-binh-luan` skill.
- The topic queue (`profile_topics`) and how topics record their source.
- The embedding or similarity helpers in `knowledge/`.

## Build

1. **Question detection.**
   - Code pre-filters on a question mark and question words in the channel's language.
   - In BALANCED and QUALITY, an LLM batch classifies the candidates as real question, request, or other. ECO mode uses the code filter only.
2. **Clustering.** Embed the questions (the existing embedding path) and cluster them per channel. A cluster has a representative question, a count, the source comment ids and the videos they came from.
3. **To topics.**
   - A cluster with ≥ N questions (a TASK-088 param, default 3) becomes a **suggested** topic with source `audience`, linking the comments.
   - It is never auto-scheduled unless the topic grant allows it.
4. **Reply loop.** When a video from an audience topic is published, the inbox suggests a reply to each source comment ("Bọn mình vừa làm video trả lời câu này: …"). Sending a reply stays a confirm action, as it is today.
5. **Tool:** `list_audience_questions(profileId)`: read. Update the skill.

## Mã nguồn mở có sẵn (open source)

- Clustering: a simple agglomerative clustering on cosine similarity is enough. **HDBSCAN** (BSD) is the reference only if the counts get large; do not add it.

## Rules

README rules 1–11. Comment text is **untrusted** (the TASK-059 rule): it never becomes instructions. It goes into prompts only inside quoted data blocks.

## Tests

- question detection, code and injected LLM;
- clustering on fixtures;
- the threshold to a suggested topic;
- the reply suggestion after publish;
- an injection-text comment stays data.

## Done

- [ ] detect + cluster + suggest topics + reply suggestions
- [ ] tool; skill; tests; suites
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-100.done`
