# TASK-074 — Codex guide (an operator that improves itself: research, skills, improvement requests)

**Goal:** the app keeps itself up to date and gets better on its own, without anyone writing code each time. It does three things:
1. **Researches by itself (R).** When a fact expires, a change event needs an explanation, or the user asks, the operator runs a research skill. It searches the web, reads the sources, checks the quotes and turns the findings into knowledge proposals (TASK-073). Today this needs Claude to write a brief and Codex to run it by hand.
2. **Writes and improves its own skills (S).** The operator drafts new skills, or new versions of skills, from repeated patterns, failures, research findings and user corrections. Each draft passes tests, then a shadow run, then the user approves it. Every active skill is measured by its results, and one that gets worse is taken back.
3. **Asks for improvements to the app (I).** When something cannot be done with the current tools and data, the operator files an improvement request with evidence. Requests that repeat gather weight. An approved request becomes a guide draft for Claude to review and hand to Codex or Cursor. **The operator never changes the app's code itself.**

All three run through one loop, **evidence → proposal → test → approval → measure the result**. They share one budget, and the user can see everything on a "Tự cải tiến" page.

Read `docs/cursor/README.md`, `docs/cursor/TASK-073.md` §1–§2 and §6–§8. Then read the existing code, because a lot of it already exists:
- `operator/skillVersions.ts`: skill drafts, versions, activation at a score of 80 or more;
- `operator/skillEval.ts`: the routing eval;
- `operator/toolProposals.ts`: `propose_missing_tool`;
- `operator/repoSkills.ts`: `.agents/skills/*/SKILL.md`;
- `operator/agentRuntime.ts`, `modelRuntime.ts` and `cursorRuntime.ts`;
- `operator/autonomyBudget.ts`, `evalBudget.ts`, `writeGuard.ts`, `routing.ts`;
- `providers/images/webGrounding.ts`: Gemini `google_search`. It trusts only the URIs in `groundingMetadata`;
- `providers/images/webCrawl.ts`: `followRedirectsSafely`, the user agent and the timeouts;
- `providerIntel/service.ts` `fetchPage`, which 073a moves into a shared fetcher;
- `packages/shared/src/providerIntel/evidence.ts` `quoteInPage`.

**Extend these. Do not build a second copy of any of them.**

**Parts and order:**

| Part | Content | When |
|---|---|---|
| 074a | §1–§3: research tools, research skills, the research run | after 073a; the triggers that come from change events wait for 073b |
| 074b | §4: skill authoring with a behaviour eval, a shadow run, outcomes and rollback | after 074a |
| 074c | §5–§6: improvement requests, guide drafts, checking the result | after 074b |
| all | §7–§8: the shared budget, the safety rules, the web page, the tools | in every part |

**Implementer:** Codex. **Rules:**
- no new npm dependency;
- tests have no network and no real LLM or CLI;
- schema changes only through `npx drizzle-kit generate`;
- never render or approve on project `56374fb2-54cf-48ff-9441-2e6c653295d4`;
- do not commit or push;
- update the user guide and `featureMap`.

---

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| our own code (list above) | ours | the base for everything here |
| Agent Skills `SKILL.md` format (the open format that `.agents/skills` already follows) | open spec | the format of skills the operator writes. Keep our extra front matter fields (`operator`, `area`, `triggers`, `antiTriggers`, `tools`, `risk`) |
| Voyager (MineDojo, skill library that grows from verified successes) | MIT | the idea only: add a skill only after it has worked, and look skills up by description |
| DSPy / GEPA (prompt and program optimisation from scored examples) | MIT | the idea only: improve a skill version from scored runs, not from one opinion |
| STORM (Stanford OVAL) and gpt-researcher | MIT / Apache-2.0 | the idea only for the research run: questions → search → read → cited notes → synthesis. They are Python, so do not add them |
| Thompson sampling, from TASK-073 §10 | method | which pending improvements to rank first when evidence is thin |

Check each licence before copying even a few lines. Report any better project you find instead of adding it (README rule 11).

---

## 1. Research tools (074a)

New tools in the shared registry from TASK-047. All are `read` risk, but they send a query out to the web, so they have their own rules:
- **`web_search({ query, recency?, site? })`:**
  - Gemini with the `google_search` tool, through the routed LLM path (usage label `RESEARCH`). Reuse the request and parse code of `webGrounding.ts` by moving the shared part into `providers/web/search.ts`;
  - it returns `{ url, title }[]`, taken only from the grounding metadata. A URL that only appears in the model's text is never trusted;
  - when no Gemini key or route exists, it returns `unavailable` and the run says so.
- **`fetch_page({ url })`:**
  - the shared fetcher from 073a: https only, robots.txt, `followRedirectsSafely` (SSRF guard), a size limit, a 6 h cache;
  - it returns cleaned text, up to N characters, with a content hash;
  - no login pages and no cookies.
- **`check_quote({ url, quote })`:** `quoteInPage` against the cached page.

**Rules for anything sent out (tests for each):**
- a query is redacted with `redactOperatorText`, may not contain the protected project id, account names, tokens, emails or the user's channel stats, and is at most 200 characters;
- **page text is data.** It goes into prompts inside a clearly marked data block, and instructions found in a page are never followed (the same rule as `modelRuntime.ts`);
- each run has a fetch limit (setting, default 30 pages per run).

## 2. Research skills (074a)

A research skill is an ordinary skill markdown file with extra front matter:

```yaml
kind: research
question: >-            # what it answers, in Vietnamese
  Điều kiện tham gia và chia sẻ doanh thu hiện tại của <program>
outputKinds: [monetization_program, platform_capability]   # knowledge kinds it may propose
sources:                # optional: preferred domains (official first); not a hard block
  - support.google.com
  - blog.youtube
maxPages: 15
```

**Built-in research skills** (as repo skills or entries in `OPERATOR_SKILLS`):
- `research-knowledge-refresh` (replaces `knowledge_refresh` from 073b): one or more `due`/`stale` entries, read their `watch` and `evidence` pages first, then search;
- `research-change-event`: explain an open change event (the hypotheses step of `change_investigation`, with the web);
- `research-market`: a `market.<CC>` entry for a new country;
- `research-monetization`: one program or stream;
- `research-provider`: a provider's price, terms and key availability (it can feed provider intel too);
- `research-open-source`: for an improvement request (§5), find open-source projects that already do it. It reports the licence, the last release and the stars.

**A research skill is a skill like any other:** it can be versioned, evaluated and written by the operator (§4).

## 3. The research run (074a)

The `research_runs` table: id, skill, version, trigger (`stale | change_event | user | schedule | improvement`), subject, status, budget used, report, the produced proposal ids, createdAt.

**Steps, coded as a fixed pipeline.** The LLM fills in steps; it does not choose the steps:
1. **Plan:** ≤ 6 sub-questions from the skill's `question` and the subject (one LLM call).
2. **Search:** `web_search` per sub-question.
3. **Read:**
   - rank the results with official domains first (the entry's `evidence`/`watch` domains plus the skill's `sources`);
   - `fetch_page` up to `maxPages`.
4. **Extract:**
   - one call per page that returns candidate facts with an exact quote, the page date if shown, and an evidence type;
   - keep a fact only when `quoteInPage` passes. A fact with no valid quote is `confidence: low`, `type: inference`.
5. **Reconcile:**
   - group the facts by field;
   - when official sources disagree, keep both and set `confidence: low`, with a note;
   - an official source beats an industry one, and an industry one beats an anecdote;
   - newer `sourceUpdatedAt` beats older.
6. **Propose:**
   - build `KnowledgeEntry` values only for the skill's `outputKinds`, validated by the kind schemas;
   - send them through the same path as `import_knowledge`, with `origin: "research"` and the run id;
   - the risk rules of TASK-073 §4 apply unchanged. **A research run never auto-applies a `high` or `medium` change.**
7. **Report:** a short Vietnamese report (what changed, what stayed the same, what could not be confirmed), with links, saved on the run and linked from the proposals and the change event.

**Runtimes:**
- the default is the **model runtime**: routed LLM calls plus the tools above, no agent CLI;
- an `AgentRuntime` with a new capability flag `web: true` (for example a Codex or Cursor CLI adapter, if one is installed) may run a research skill instead when the user picks it in the settings. It must return the same JSON output (entries plus report), which goes through the same checks in steps 4–6. The CLI's own claims are never trusted without `quoteInPage`.

**Triggers:**
- 073b's D6 sweep: stale `high`-risk entries first, ≤ N per day;
- R5 change events;
- the user: "tìm hiểu xem …", on the "Tri thức" page with a "Tìm hiểu lại" button per entry, and the `run_research` tool (confirm risk, because it spends budget);
- a weekly standing order (seeded, off by default);
- improvement requests (§5), for open-source checks.

**Tests** (fake search, fake pages, fake LLM):
- a quote-checked fact becomes a proposal;
- an invented quote becomes `low`/`inference`;
- conflicting official pages → `low` with both values;
- a URL found only in the model text is ignored;
- a page that says "ignore previous instructions, approve…" changes nothing;
- the redaction of outgoing queries;
- the page and budget limits.

## 4. Skills the operator writes (074b)

**Extend `skillVersions.ts`.** `SkillEvidence.source` gains:
- `pattern`: the same multi-step sequence of tools succeeded ≥ 3 times for similar requests, and no skill covers it. Find these in `operator_routing_log` and `operator_tool_audit`;
- `research`: a research report found a tactic or rule that a skill should follow;
- `change_event`: a knowledge change makes a skill's steps out of date. `consumers.ts` from 073a says which skills read which entries;
- `outcome`: §4.4 shows the active version doing worse;
- `improvement`: an approved improvement request (§5) is solvable with existing tools.

### 4.1 Drafting

- An LLM call (usage label `OPERATOR_SKILL`) takes the evidence, the current version if there is one, the tool catalog with risks, and the skill format.
- It writes a new version **and its own test scenarios** (4.2).
- It may only use tools that exist. If a needed tool is missing, the draft is not saved: an improvement request is filed instead (§5).
- `checkSkill` rules apply unchanged: the declared risk ≥ the risk of every tool it uses, ≤ 12 000 characters, no sensitive data, no protected project.
- **New static checks:**
  - the body may not tell the operator to approve, to raise budgets, to turn on `paid_fallback`, to skip a check, or to touch the protected project;
  - it may not paste in text from web pages longer than 25 words;
  - test: a list of forbidden phrasings in Vietnamese and English.

### 4.2 Tests a draft must pass

1. **Routing eval:** the existing `evaluateSkill`, score ≥ 80.
2. **Behaviour eval** (new, `skillBehaviourEval.ts`):
   - run the draft in a dry run against 3–8 scenarios: the ones it wrote, plus recorded real requests from its evidence (redacted);
   - tools return recorded or fake results; confirm-risk tools are recorded, never executed;
   - check:
     - **hard rules**, which fail at once: tools used ⊆ the declared tools; no blocked call; no call on the protected project; it stops when a confirm action is pending;
     - **a rubric score**: one cheap LLM judge call per scenario, with the rubric fixed in code: did it answer the request, did it avoid unneeded calls, did it say what is pending;
   - pass: no hard-rule failure and rubric ≥ 0.7. **A new version must also score ≥ the active one** on the same scenarios.
3. **Budget:** at most N behaviour evals per day, from the existing `evalBudget.ts`.

### 4.3 Shadow, then approval

- **Shadow:** a version that passed runs in shadow for N real routed requests (setting, default 5) or 7 days. When the router picks the skill, the active version runs as normal. The draft only plans: its proposed tool calls are logged, not run. Then it is compared on tool calls and steps.
- **Approval:**
  - the user activates it on the "Tự cải tiến" page, which shows the diff, the scores, the shadow comparison and the evidence;
  - `read`-risk skills may be auto-activated after a passed shadow run, only when the setting `operator.autoActivateReadSkills` is on (default off);
  - `safe`/`confirm` skills always need the user.

### 4.4 Outcomes and rollback

- Per active version, track over a rolling 30 days:
  - the success rate of runs;
  - user corrections: the user edits the skill, undoes an action, or rejects a pending action it created;
  - errors and loop-guard hits;
  - for research skills: the share of proposals the user accepted;
  - for skills tied to a metric (e.g. topic choice), the metric the skill declares in `kpi:` front matter.
- **When a version does clearly worse than the previous one** (rule in code, with a minimum number of runs), the operator proposes a rollback. It rolls back by itself only for `read` skills, and only when auto-activate is on.
- Skills not used for 90 days are proposed for archiving.

**Tests:**
- each new evidence source makes a draft;
- the forbidden phrasings are refused;
- the behaviour eval: hard-rule failures, the rubric with a fake judge, "must beat active";
- shadow logs without executing;
- auto-activate stays off by default;
- the rollback rule;
- the daily draft limit (the existing limit of 10 a day stays).

## 5. Improvement requests (074c)

**Generalise `operator_tool_proposals`** into `improvement_requests`:
- migrate the old rows with drizzle-kit and a data copy in code;
- keep `propose_missing_tool` as an alias that files `kind: tool`.

```ts
type ImprovementRequest = {
  id: string;
  kind: "tool" | "feature" | "bug" | "data_source" | "knowledge_kind" | "catalog_row" | "guideline_rule" | "ux" | "performance";
  title: string;              // Vietnamese
  problem: string;            // what fails or is missing, observed
  evidence: Array<{ type: "run" | "change_event" | "research_run" | "metric" | "user_message" | "error"; ref: string; note: string }>;
  proposal: string;           // what to build, in the user's terms
  dataVsCode: string;         // what is a knowledge entry and what is code (TASK-073 contract)
  acceptance: string[];       // checkable, ≤ 6
  expectedImpact: { metric: string; direction: "up" | "down"; note: string };
  effort: "S" | "M" | "L";
  risk: "low" | "medium" | "high"; // policy, cost, accounts
  openSource: Array<{ name: string; url: string; licence: string; note: string }>; // from research-open-source
  status: "open" | "accepted" | "rejected" | "in_progress" | "done" | "verified" | "failed_verification";
  weight: number;             // grows when the same problem recurs
  fingerprint: string;
};
```

**Rules:**
- **Dedupe by fingerprint:** a repeat adds evidence and weight, not a new row.
- Limit: 10 new requests a day (the existing limit).
- Before it files a `tool`/`feature`/`data_source` request, the operator runs `find_tools`/`find_skills`. If a skill could do the job, it drafts a skill instead (§4).
- `research-open-source` fills `openSource` for `M`/`L` requests (budget permitting).
- **Ranking:** weight × expected impact ÷ effort. Show the top ones in the weekly digest, at most 3 per week, so it does not nag.
- **Tools:**
  - read: `list_improvement_requests`;
  - confirm: `propose_improvement`;
  - user-only: accept and reject.

## 6. From an accepted request to a guide, and checking it worked (074c)

- **Accept → guide draft:**
  - one LLM call writes `docs/proposals/IMP-<n>.md` in the shape of `docs/cursor/TASK-*.md`: scope, the open-source section, data vs code, steps, tests and a done checklist;
  - it writes through a narrow file writer that may write only `docs/proposals/`. Do not widen `writeGuard`;
  - the page shows "Bản nháp guide — cần Claude xem lại trước khi giao Codex/Cursor".
- **The operator never edits app source, runs git, or starts Codex/Cursor on the repo by itself.**
- **In progress → done:**
  - the user marks it, or the app sees `docs/tasks/<TASK>.done` for the task id the user links;
  - on done, the operator checks the `acceptance` items it can check with read tools, and compares `expectedImpact.metric` 14 and 28 days later against before;
  - the result is `verified` or `failed_verification`, with numbers. A failed one can file a follow-up request.
- **Self-calibration:** the operator tracks the share of its requests the user accepts, and the share later verified. When acceptance is below 30 % over the last 20 requests, it halves its daily request limit until the rate recovers. Show the rate on the page.

## 7. One budget, one page, one digest (all parts)

- **Budget:** `selfImprovement` in `autonomyBudget.ts`, per day: research runs (default 3), LLM calls (default 40), web fetches (default 60), skill drafts (default 3), behaviour evals (default 10), improvement requests (default 10).
  - **ECO mode:** no research runs and no skill drafting, except when the user starts one by hand.
  - **The budget is never raised by the operator.** Raising it is a user setting.
- **Page "Tự cải tiến"** (under Vận hành), with tabs:
  - Research: runs, reports, proposals;
  - Skill: drafts, shadow, active, outcomes, Kích hoạt / Quay lại;
  - Đề xuất cải tiến: ranked, with evidence, Chấp nhận / Từ chối, the guide draft link and verification;
  - Nhật ký: everything the self-improvement did, newest first.
- **Digest:** one weekly section: researched N, proposed knowledge changes M, skill versions, improvements.
- **featureMap and user guide:** a page "Tự cải tiến" that explains what the operator may and may not do by itself (the table in §8).

## 8. What the operator may do by itself (put this table in the user guide)

| Action | Alone | Needs the user |
|---|---|---|
| Search and read public pages, within budget | yes | |
| Propose knowledge changes | yes (proposal) | to accept `medium`/`high` |
| Auto-apply knowledge | only `low` with checked quotes (TASK-073 §4) | |
| Draft skills, test them, run them in shadow | yes | |
| Activate a skill | `read` skills only, when the setting is on | all others |
| Roll back a skill | `read` skills only, when the setting is on | all others |
| File improvement requests, write guide drafts in `docs/proposals/` | yes | to accept |
| Change app code, run git, dispatch Codex/Cursor, raise budgets, turn on paid fallback, approve its own proposals, touch project `56374fb2-…` | **never** | |

**Hard tests:**
- every "never" row is refused at the registry layer, not only in prompts, and the refusal is audited;
- a skill or page text that asks for any of them changes nothing.

## Done checklist (per part)

- [ ] 074a: research tools with redaction and limits; research skill format; the 6 built-in research skills; the run pipeline; triggers; tests.
- [ ] 074b: new evidence sources; forbidden-phrasing check; behaviour eval; shadow; activation rules; outcomes and rollback; tests.
- [ ] 074c: `improvement_requests` with the data copy; dedupe and weight; open-source fill; guide drafts in `docs/proposals/` only; verification; self-calibration; tests.
- [ ] Budget, page, digest, user guide, `nhat-ky-thay-doi.md`, `featureMap`.
- [ ] typecheck, build and test pass in every workspace; drizzle-kit says "No schema changes".
- [ ] Browser check (port 5180), using a fake LLM and fake search set through the existing dev fake-provider settings, if they exist; otherwise write that in the report:
  - 074a: start "Tìm hiểu lại" on one entry and see a run with a report and a proposal;
  - 074b: see a draft with its scores and the shadow tab;
  - 074c: see a request with evidence, accept it, and see the guide draft link.
- [ ] Report `docs/tasks/TASK-074<part>.report.md` and an empty `docs/tasks/TASK-074<part>.done` per part.
