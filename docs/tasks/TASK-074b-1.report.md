# TASK-074b-1 report — nguồn bằng chứng mới và kiểm cụm từ cấm

**Status: implemented, not reviewed.** No `.done` is written; Codex review is still required.
**Migration:** none.

## Changes

- `apps/server/src/operator/skillDraftChecks.ts` (new):
  - `BANNED_PHRASES`: five rules from `docs/cursor/TASK-074.md` §4.1, each with Vietnamese and English phrasings.
  - `findBannedPhrase`: checks the body only (after YAML frontmatter). A phrase preceded by a negation (`không`, `chớ`, `đừng`, `cấm`, `never`, `not`, `no`, `don't`, `do not`, `must not`, `cannot`, `can't`) in the same clause is a prohibition and is not flagged. A clause ends at `. ; : ! ? , |`. Text is NFC-normalised first.
  - `quotedSpans` / `findLongQuote`: a span is text in straight or curly double quotes on one line, or a run of adjacent blockquote lines (merged into one span). Frontmatter and fenced code are not quotes. `MAX_QUOTED_WORDS = 25`, checked per span.
- `apps/server/src/operator/skillVersions.ts`:
  - `SkillEvidence.source` union extended with `pattern | research | change_event | outcome | improvement`; the four original values kept.
  - `SKILL_EVIDENCE_SOURCES`; `saveSkillDraft` rejects any other value (`INVALID_SKILL_EVIDENCE`).
  - `checkDraftText` runs in `saveSkillDraft` after `checkSkill`. It is NOT in `checkSkill`, so `activateSkillVersion` is unchanged.
- `apps/web/src/features/operator/SkillVersions.tsx`: type and label map include the five new sources (labels: Mẫu lặp lại, Nghiên cứu, Thay đổi, Kết quả, Cải tiến).
- `apps/server/test/skillDraftChecks.test.ts` (new, 13 tests).
- `docs/cursor/TASK-074b-1.md`: step 2 names `skillDraftChecks.ts`; the check is described as running in `saveSkillDraft`.

## Corpus scan (read-only, before the negation and frontmatter fixes)

Scanned 186 items: the built-in `OPERATOR_SKILLS` (rendered) and every `.md` under `.agents/` and `.cursor/`.
- Built-in operator skills: 8 hits, all false positives. Negated safety lines ("Skill không tự nhập và không tự duyệt.", "Không bật paid_fallback, không đổi key.") and a trigger word ("tự duyệt đề xuất" in frontmatter). Fixed by negation handling and by checking the body only. After the fixes, every built-in operator skill passes (test "every built-in operator skill passes the draft checks").
- Repo `.agents/` docs (not operator skills, not affected by the check unless saved as a draft): 8 hits remain. Examples: `video-stage-kich-ban` "Chờ, hoặc để người dùng nâng ngân sách" (an instruction to a human, not the operator). Long-quote hits are YAML descriptions and blockquotes in those docs.

## Tests run

- `npx vitest run test/skillDraftChecks.test.ts test/proposeSkill.test.ts`: 24 passed.
- Skill and operator suites (15 files, including operator, operatorRouting, operatorWorkspace, reviewProposals, researchPolicy, auth.test): 97 passed.
- `npx tsc --noEmit -p apps/server`: exit 0.
- `apps/web` typecheck: no errors in `SkillVersions.tsx`.

## Advisor rulings applied (the user may overturn)

1. The checks run in `saveSkillDraft`, not in `checkSkill` or `activateSkillVersion`. A test shows a stored version with a 26-word quote still activates.
2. The banned-phrase rule is scoped to the body, not frontmatter (§4.1 says "the body may not"). Frontmatter triggers such as "tự duyệt đề xuất" are routing words.
3. Negation in the same clause makes a phrase a prohibition, not an instruction.
4. Quote spans: per span, blockquote lines merged, frontmatter and code excluded.

## Open points

- The checks apply to every source, including `user_edit` and `user_review`. §4.1 is about drafts the LLM writes. A user's own edit containing an unnegated banned phrase is rejected. Decide whether user sources should be exempt.
- The four new evidence sources have no daily cap; `repeated_failure` and `agent_proposal` keep the cap of 10 per 24 h.
- Substring and clause matching can miss paraphrases and can flag an instruction to a human. The repo `.agents/` hits are the known false-positive set.
- `repeated_failure` appears in `apps/server/src/operator/service.ts:1406`; `agent_proposal` in `fleet/service.ts:183` and `assistant/tools.ts:1800`; `user_edit` in `service.ts:786`. All use typed string literals within the union, so the compiler checks them.

## Not done here

- Codex review (`docs/tasks/TASK-074b-1.done` waits for it).

## Đã kiểm tra thêm: đường gọi `user_review` và `user_edit`

- `user_review` (`apps/server/src/operator/service.ts` ~755–767): mỗi lần gọi chỉ nhận một file markdown. Lỗi từ `saveSkillDraft`, gồm cả `checkDraftText`, được `catch` và trả `{ ok: false, errors }`. Không có nguy cơ dừng hàng loạt khi một bản nháp bị từ chối.
- `user_edit` (`service.ts` ~785–795): lỗi từ `checkDraftText` (`INVALID_OPERATOR_SKILL`, 400) không bị bắt trong service, nên nổi lên thành HTTP 400 cho người sửa. Đây là hành vi mong muốn, nhưng cùng câu hỏi mở về việc có miễn kiểm tra cho nguồn do người dùng sửa hay không.
- Vẫn chưa có `docs/tasks/TASK-074b-1.done`. Chờ Codex review.
