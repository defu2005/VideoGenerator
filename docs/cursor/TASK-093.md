# TASK-093 — Channel playbook: what this channel has learned, used in every prompt 📘

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** yes (🗄); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-092a (experiment conclusions are the main evidence).

## Why

Lessons ("hook bằng câu hỏi giữ chân tốt hơn 8 % ở kênh này") live in reports and chat and are forgotten. A playbook is:
- a short list of active, evidence-backed statements per channel;
- injected into the script, packaging and director prompts;
- able to expire.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 `channel_playbook_entries`, §4 group `playbook`.
- The RAG index: `retrieval_chunks`, `knowledge/`; how profile context is searched (`search_profile_context`).
- `apps/server/src/operator/playbooks.ts`: an unrelated name clash. Rename it to `operator/runbooks.ts` (update the imports only).

## Build

1. **Table** as in §3:
   - statement, scope (all, format, market or length band), evidence (experimentId and/or publicationIds, and a quote);
   - confidence, status (`proposed|active|retired|expired`), expiresAt (default 120 days), createdBy, activatedBy, `supersedesId`.
2. **Evidence check (code).**
   - An entry must point at an existing concluded experiment, or at ≥ 3 publications with metrics. Otherwise it is refused.
   - Confidence comes from the evidence (the experiment CI, or n), not from the agent.
3. **Activation.** Only the user (or a future grant) moves an entry from `proposed` to `active`. On activation, the entry is indexed into `retrieval_chunks` with the profile scope; on retire or expire, it is removed.
4. **Prompt use.**
   - The script, packaging (095) and director prompts get the top-k active entries that match the project's scope, as a "Bài học của kênh" block with entry ids.
   - The LLM output may cite the ids; record which entries were used in the project, for later evaluation.
5. **Tools:**
   - `search_playbook`: read;
   - `add_playbook_entry`: safe, creates a `proposed` entry;
   - `retire_playbook_entry`: safe.

   The 092a conclusions automatically create `proposed` entries. Add a skill section in `video-chien-luoc-kenh`.
6. **Web.** A "Playbook" tab on the profile page: active, proposed (approve or reject), and expired entries, with the evidence links.

## Mã nguồn mở có sẵn (open source)

- Nothing direct. The design follows "evidence-backed memory", like **Mem0** (Apache-2.0) and **Letta** (Apache-2.0) memory blocks, but our evidence rule is stricter. Reference only.

## Rules

README rules 1–11. The agent never activates an entry. An entry never overrides guidelines or safety.

## Tests

- an entry without evidence is refused;
- confidence comes from the evidence;
- only the user activates;
- index on activate and remove on retire or expire;
- prompt injection by scope;
- used ids are recorded;
- the rename compiles.

## Done

- [ ] table + evidence check + activation + index
- [ ] prompt use in 3 stages; tools; skill; tab
- [ ] tests; suites; migration
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-093.done`
