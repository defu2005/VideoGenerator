# TASK-046: Cursor guide (provider intelligence, account benefits, billing risk, OmniRoute optimisation)

Read these first: `docs/cursor/README.md`, `TASK-044.md`, `TASK-045.md`, and `TASK-047.md`. All three are committed. TASK-044 and TASK-045 give you quota rules, the live OmniRoute quota sync, and the management token in the vault. TASK-047 gives you the Cursor operator and the single tool registry.

No new npm dependencies.

Tests never use the network: mock `fetch`, and use fixture HTML/JSON.

## Why

The user wants a system that does four things and keeps the results up to date:

1. Find AI API providers that give free API access in some form: a free tier, trial credit, promo credit, a developer or startup program, or free models.
2. Check each one for:
   - legitimacy;
   - ToS;
   - privacy and security;
   - billing and auto-charge risk;
   - eligibility from **Vietnam** for a personal account.
3. Audit every provider already in the user's OmniRoute, together with the wider benefits of those accounts (cloud credits, storage, GPUs and so on).
4. Keep OmniRoute's model catalogue and routing tuned for the user's projects.

The rule behind all of it is **zero unauthorised spending**: the system never adds a card, pays, tops up, enables auto-recharge, accepts new terms, or starts paid resources.

The system lives **inside this app**:
- server code;
- DB tables with history;
- a new "Nhà cung cấp AI" page;
- in-app scheduled jobs.

It also writes its evidence and reports to a `provider-intelligence/` folder at the repo root, as JSON and Markdown.

## 0. Hard limits (read twice)

**Credentials**
- Never read, print, log, copy, or commit API keys, cookies, tokens, or session ids.
- OmniRoute keeps credentials in `~/.omniroute/storage.sqlite`. **Do not open that file.** Use only OmniRoute's management HTTP API, authenticated with the TASK-045 vault token. If no token is saved, fall back to `OMNIROUTE_API_KEY` for `/v1/models` only.
- Reports may show only whether a credential is present (`credentialPresent: true`), never its value.

**Accounts, legal steps and payments**
- No account creation.
- No logins to provider dashboards.
- No CAPTCHA or identity steps.
- No accepting ToS.
- No claiming credits.
- No payment actions of any kind.
- "Dashboard" facts (balance, auto top-up state, card on file) come only from two places:
  - what OmniRoute's API reports;
  - a checklist the user fills in by hand.

  Each field records its source (`omniroute` | `user_checked` | `public_docs`) and a date.

**Network use at runtime**
- Fetch only **official** provider pages (pricing, docs, ToS, privacy, status, changelog, RSS) and GitHub advisories.
- Do not scrape search engines.
- Use one request per URL per run, a 15 s timeout, and the identifying User-Agent `video-agent-provider-intel/1.0`. Respect `robots.txt` disallow.
- Never send project source code or private data to any provider.

**Inference probes**
- Use only the cheapest request through the local OmniRoute gateway: `max_tokens: 1`, prompt `"ping"`.
- Run them only for API-key providers. **Never** probe web-session or cookie connections (OmniRoute connections whose auth is a browser session or cookie, or whose type is unknown).
- Run them at most once per model per day, and only on a user click or the weekly job.

**Changes to OmniRoute**
- Make changes only through its API (combos, model aliases, model lists).
- Call `/api/db-backups/export` first and keep the backup id.
- Afterwards, re-test the providers that already worked.
- Never add a new provider connection that needs a key. The user adds keys in OmniRoute themselves.
- Never delete a connection.

**Routing in this app**
- Route and profile proposals follow the model-advisor rule: proposals only. The user clicks Apply.
- Never enable a paid fallback.

**Off-limits files and tasks**
- Do not touch `.env`, `.claude/`, `data/` (except through app code writing its own tables), or `scripts/`.
- Do not create Windows scheduled tasks or services.
- Never touch project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## 1. Data model (`packages/shared/src/schemas/providerIntel.ts`, zod, strict)

Every factual field is an `Evidenced<T>`:

```
{ value: T | "UNKNOWN", sourceUrl?: string, quote?: string, source: "public_docs" | "omniroute" | "user_checked" | "user_report" | "independent", verifiedAt: string }
```

Rules for `Evidenced` fields:
- If `value` is not `"UNKNOWN"`, then `sourceUrl` and `verifiedAt` are required.
- Never invent numbers. A value that cannot be verified is `"UNKNOWN"`.
- **`UNKNOWN` is never treated as safe.** In particular, an `UNKNOWN` exhaustion behaviour is never treated as `HARD_STOP`.

### Provider

**Identity**
- `id`, `name`, `website`;
- `legalEntity`, `country`, `parentCompany`;
- `legitimacy`: `A` | `B` | `C` | `D`, with a reason;
- `categories`: llm, embedding, rerank, image, video, tts, stt, gpu, cloud, aggregator.

**API**
- `api.protocols`: openai | anthropic | native;
- `api.baseUrl`;
- `api.docsUrl`.

**ToS** (each field Evidenced, plus a short Vietnamese summary)
- `tos.commercialUseAllowed`
- `tos.freeOutputCommercial`
- `tos.agentsAllowed`
- `tos.resaleAllowed`
- `tos.multiAccountBanned`
- `tos.freeQuotaRevocable`
- `tos.creditsExpire`
- `tos.nonProductionOnly`
- `tos.suspendWithoutNotice`
- `tos.geoRestrictions`
- `tos.kycRequired`
- `tos.conflictsVi[]`: the clauses that could clash with the user's apps.

**Privacy**
- `privacy.trainsOnPrompts`
- `privacy.optOut`
- `privacy.zeroRetention`
- `privacy.retentionDays`
- `privacy.dataResidency`
- `privacy.certifications[]`
- `privacy.subprocessorsUrl`
- `privacy.incidents[]`, each with a date, a summary and a URL.

**Vietnam eligibility**
- `vietnam.signupAllowed`
- `vietnam.vnCardAccepted`
- `vietnam.needsChinesePhoneOrId`
- `vietnam.needsBusiness`
- `vietnam.personalAccountOk`

### Offer (several per provider)

- `kind`, one of:
  - `permanent_free`
  - `monthly_free`
  - `daily_free`
  - `signup_credit`
  - `promo_credit`
  - `referral_credit`
  - `startup_credit`
  - `grant`
  - `free_models_rate_limited`
  - `chatbot_only_not_api`

  `chatbot_only_not_api` is never counted as API value.
- `amount` and `unit`. Unit is `usd` | `tokens` | `requests` | `credits` | `gpu_hours`.
- Limits: RPM/TPM/RPD, context, `models[]`.
- `expiresAt` and `requirements[]`.
- `appliesTo`, one of: `api_inference` | `cloud_other` | `chat_ui`.
- `status`: `active` | `expired` | `unverified`.

Expired offers move to the expired list. They are never deleted.

### Billing (one per provider, plus optional per-service overrides)

- `mode`: free | prepaid | postpaid | subscription | payg.
- `cardRequired`.
- `authHold` as `{ exists, amount, captured }`.
- `autoTopup` as `{ defaultOn, canDisable, trigger, min, max }`.
- `thresholdBilling` as `{ exists, defaultUsd, autoRaise }`.
- `recurringSubscription` and `trialAutoConverts`.
- `postpaidCollectsOutstanding`.
- `exhaustionBehaviour`: `HARD_STOP` | `SOFT_STOP` | `AUTO_TOPUP` | `POSTPAID` | `SUBSCRIPTION_CONVERSION` | `UNKNOWN`.
- `spendingControls`: hard cap, monthly cap, per-project, per-key, per-model, alerts, auto-suspend, key revocation, card removal.
  - Mark a control `hardCap: true` only when the cap is enforced.
  - An alert is not a cap.
- `revokingKeyStopsCharges` and `stoppingRequestsStopsCharges`.
- `safestZeroSpendConfigVi`: the safest zero-spend setup, explained in Vietnamese.
- `riskLevel`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`, computed by the rules in §5 of the user brief (copied in §4 below).

If any of the 10 acceptance answers (§4) is `UNKNOWN`, set the flag `BILLING_UNVERIFIED`.

### Ecosystem benefits (per provider)

Rows for these services:
- LLM API, GPU, VPS, object storage, database, Kubernetes, serverless;
- image, video, speech;
- agent sandbox, developer credits.

Each row records: available, free quota, expiry, whether a card is required, auto-billing risk, and the condition. The condition is one of:
- `permanent`
- `time_limited`
- `one_time`
- `monthly`
- `needs_payment_verification`
- `needs_kyc`
- `company_only`

### Account (only for providers the user already has)

- `omnirouteConnectionIds[]`;
- `status[]`, using the addendum states:
  - `CONFIGURED`
  - `AUTHENTICATED`
  - `CONNECTED`
  - `MODEL_DISCOVERED`
  - `CALLABLE`
  - `RATE_LIMITED`
  - `QUOTA_EXHAUSTED`
  - `EXPIRED`
  - `INVALID_CREDENTIALS`
  - `UNKNOWN`
- `lastSuccessAt` and `errors[]`;
- `benefits[]` with an `eligibility` of:
  - `in_account`
  - `needs_manual_activation`
  - `needs_user_approval`
  - `advertised_unconfirmed`
  - `expired`
- `userChecklist`: dashboard facts the user confirmed, each with a date.

### Model

- `providerId`, `modelId`, `aliases`;
- `deprecated`;
- context and max output;
- `pricing`;
- `capabilities`: streaming, tools, json, vision, audio, video. Each capability is `"tested" | "documented" | "UNKNOWN"` plus a value. **Never infer a capability from the model name.**
- the rate limits;
- `lastProbe` as `{ at, ok, latencyMs, errorKind }`, where `errorKind` is one of:
  - `auth`
  - `quota`
  - `rate_limit`
  - `outage`
  - `not_found`
  - `other`

### Scoring

The weights are fixed:

| Factor | Weight |
|---|---|
| Legitimacy | 15 |
| Security and privacy | 20 |
| ToS and commercial use | 15 |
| Free value | 20 |
| Vietnam | 10 |
| API compatibility | 10 |
| Reliability and quality | 10 |

- An `UNKNOWN` input scores 0 for that factor. It is not averaged away.
- Write the scorer as a pure, tested function.
- Risk flags are independent of the score:
  - `LEGAL_RISK`
  - `PRIVACY_RISK`
  - `BILLING_RISK`
  - `BILLING_UNVERIFIED`
  - `REGION_RESTRICTION`
  - `UNVERIFIED_COMPANY`
  - `PROMOTIONAL_ONLY`
  - `NO_API_ACCESS`
  - `NONCOMMERCIAL_ONLY`
  - `SECURITY_INCIDENT`
  - `ACCOUNT_SUSPENSION_RISK`
- A provider with legitimacy `D`, an unresolved `SECURITY_INCIDENT`, `CRITICAL` billing, or `BILLING_UNVERIFIED` is `autoConfigAllowed: false`, whatever its score.

## 2. Storage and history

**DB tables** (`npx drizzle-kit generate`, never hand-written):
- `provider_intel_records`: kind, key, json, `version`, `created_at`, `superseded_at`.
  - **Append only.** An update inserts a new version and marks the old one superseded.
  - Nothing is ever overwritten or deleted.
- `provider_intel_pages`: url, provider, page kind, last hash, last fetched, last changed, status.
- `provider_intel_probes`: provider, model, at, ok, latency, error kind.
- `provider_intel_changes`: what changed, old/new summary, `needsReview`, reviewed by the user at.

**Export to `provider-intelligence/`** (repo root, plain files the app writes), after every job and on demand:
- `providers/provider_catalog.json`, `providers/model_catalog.json`, `providers/provider_details/<id>.json`
- `offers/active_offers.json`, `offers/expired_offers.json`
- `security/security_assessments.json`, `security/incident_history.json`
- `legal/tos_assessments.json`, `legal/privacy_assessments.json`
- `monitoring/provider_status.json`, `monitoring/quota_status.json`, `monitoring/health_checks.json`
- `config/routing_profiles.json`, `config/provider_policy.json`
- `billing/`, one file each:
  - `billing_risk_report.json`
  - `auto_charge_status.json`
  - `payment_authorization_report.json`
  - `free_quota_exhaustion_behavior.json`
  - `active_subscriptions.json`
  - `active_paid_resources.json`
  - `spending_control_capabilities.json`
  - `unexpected_charge_warnings.json`
- `accounts/`, one file each:
  - `existing_omniroute_providers.json`
  - `provider_account_benefits.json`
  - `cloud_ecosystem_benefits.json`
  - `unused_account_benefits.json`
  - `expiring_credits.json`
  - `activation_instructions.md`
  - `provider_audit_history.json`
- `reports/daily/`, `reports/weekly/`, `reports/changes/`: Markdown in Vietnamese.

**`provider-intelligence/README.md`** explains the folder and says the files are generated (the DB is the source of truth).

**`.gitignore`** gets `provider-intelligence/monitoring/` and `provider-intelligence/reports/`, because they are volatile. Research and assessments stay tracked.

**Redaction:** run a pure redaction pass over every export and log. It removes anything that looks like a key, token, cookie, or email; emails are masked as in TASK-045. Test it.

## 3. Who does the research: the Cursor operator (TASK-047), not this implementation run

**Order.** TASK-047 (the Cursor operator) is committed before this task. The research and judgment work below is done **by the operator session**, at either of these times:
- on a schedule, through standing orders (see the TASK-047 additions below);
- when the user asks in chat, for example "đánh giá lại DeepSeek", "tìm nhà cung cấp free mới", or "kiểm tra rủi ro thanh toán Scaleway".

**What you build in this task** is the system the operator works through:
- the schemas, storage and history;
- the code jobs;
- the MCP and registry tools (§9);
- the UI;
- the OmniRoute audit and write path;
- all the guards.

**Seed data.** Ship only the provider **stubs** (names, websites, `needs_research: true`), for the lists below, plus small fixtures for tests. Do not research the providers yourself in this run.

**Mechanical work stays in code** (the project rule: no LLM spend on mechanical work):
- page fetch;
- hash diff;
- expiry moves;
- the OmniRoute audit;
- probes;
- scoring;
- exports.

**Judgment work goes to the operator:**
- reading ToS, privacy and pricing;
- filling assessments;
- discovering new providers;
- writing the weekly report's commentary;
- proposing routing.

The `providerIntelExtract` LLM task in §6 stays as the fallback for when the operator is off.

**What the operator researches** (this goes into its standing order text; see §9): the providers listed below. For each one it follows the per-provider rules below the list.

**Providers**
1. Every provider currently connected in the user's OmniRoute. Get the list at runtime (§5). For the seed, cover the provider types OmniRoute supports that are likely to be connected: GitHub Copilot, Antigravity, Claude, Codex, Gemini, OpenRouter, Groq, Cerebras, Mistral, Cohere, Cloudflare Workers AI, SambaNova, Together, and Hugging Face.
2. The previously investigated list. Re-verify each one; do not trust old notes:
   - BytePlus ModelArk
   - Volcengine Ark
   - LongCat
   - DeepSeek
   - AI21
   - Hyperbolic
   - Nscale
   - DeepInfra
   - Fireworks AI
   - Nebius
   - Scaleway
   - Novita AI
3. At least 8 more you discover, across direct LLM, GPU and inference platforms, aggregators, image/video/TTS APIs, and developer/startup programs.

**Rules for each provider**
- Read the **current official** pricing, docs, ToS, and privacy pages. Record the URL, a short exact quote (≤ 25 words) supporting each non-UNKNOWN fact, and today's date.
- Fill the billing block fully, including the §4 answers.
- If you cannot open a page, the facts it would support are `UNKNOWN`, and the provider gets `needs_research: true`.
- **No guessing from memory.** A value without a source is `UNKNOWN`.
- Vietnam eligibility: use only what the signup page, ToS, or supported-countries list says. Website reachability is not evidence.
- Use Scaleway as the reference for a full ecosystem matrix.

## 4. Billing acceptance answers (per provider, Evidenced)

1. Can it charge the card automatically?
2. What event triggers the charge?
3. Can auto-charge be disabled?
4. Can paid usage continue after free credits run out?
5. Does it collect outstanding balances automatically?
6. Is there a true hard spending limit?
7. Does deleting the API key stop future charges?
8. Does stopping requests stop all charges?
9. Are there active subscriptions or paid resources? This is account-specific: use the user checklist, otherwise `UNKNOWN`.
10. What is the safest zero-spend configuration?

**Risk level rules**
- **LOW:** no card needed, a fixed free quota, no automatic paid usage, and a hard stop when the quota runs out.
- **MEDIUM:** a card is needed and there is free quota, but paid use needs an explicit manual action and there is no auto top-up.
- **HIGH:** any of: auto-charge on by default, postpaid billing, threshold collection, paid use continuing after free quota, or no hard limit.
- **CRITICAL:** any of: unclear terms, auto-pay that cannot be disabled, unclear collection, or an authorization hold that cannot be verified.

Write these as pure, tested functions.

## 5. OmniRoute audit (`apps/server/src/providerIntel/omnirouteAudit.ts`)

Use the management API with the vault token:
- `GET /api/providers`: the connections and their type.
- `GET /api/providers/{id}/models`
- `GET /api/models`, `GET /api/models/alias`, `GET /api/models/catalog`
- `GET /api/combos`
- `GET /api/usage/{id}`: reuse the TASK-045 sync.
- `POST /api/providers/{id}/test`: use OmniRoute's own connection test. Prefer it over our own inference probe, and run it only for non-cookie connections.

**Status per connection.** Build the addendum states from these signals:
- configured (the connection exists);
- credential present (a flag only);
- test result;
- models discovered;
- a probe that succeeded → `CALLABLE`;
- a 429 → `RATE_LIMITED`;
- a TASK-045 snapshot that says exhausted → `QUOTA_EXHAUSTED`;
- 401/403 → `INVALID_CREDENTIALS`.

"Connected" is not "callable". Show both.

**No token saved:** the audit says `needs_token` (reuse the TASK-045 steps text) and lists only what `/v1/models` reveals.

Link each connection to a provider record. For an unknown provider type, create a `needs_research` stub.

## 6. Monitoring jobs (in-app scheduler, the same mechanism TASK-045 uses; no OS tasks)

**Daily**
- Re-fetch the tracked offer, pricing, and status pages.
- Hash-diff each page. On a change, store a `provider_intel_changes` row with `needsReview` and a Telegram `attention` line.
- Move offers past `expiresAt` to expired.
- Check the expiring credits (≤ 7 days).
- Refresh the OmniRoute audit.

**Weekly**
- Refresh model catalogues from OmniRoute and from each approved provider's official model list endpoint where it is public.
- Run the probes (§0 limits).
- Recompute scores.
- Write the weekly report.

**Monthly**
- Re-fetch the ToS and privacy pages. A change sets `needsReview` and lowers confidence on the affected fields until the user re-verifies them.

**Optional LLM extraction.** A new LLM task `providerIntelExtract`:
- cheap tier, budget feature;
- default on in BALANCED/QUALITY, off in ECO.

It reads a fetched official page's text and proposes field updates. **Every proposed value must come with a quote that occurs verbatim in the fetched text**, checked in code by substring match after whitespace normalisation. Otherwise the value is dropped and becomes `UNKNOWN`. Proposals become new versions marked `source: public_docs` and `needsReview: true`; they never overwrite user-checked facts.

**Discovery of new providers.** Read from a curated list of official RSS/changelog feeds and GitHub "awesome free LLM API" style lists that the user can edit in the UI. Only read them. New names become `needs_research` stubs. No search-engine scraping.

## 7. Routing profiles and OmniRoute optimisation

**Profiles**

Task profiles, written as data in `packages/shared/src/providerIntel/routingProfiles.ts`:
- coding (Java/Spring, React/TS, Python, Docker, Postgres, architecture);
- video app (research, script, story breakdown, vision, image gen, TTS, subtitles, ffmpeg help);
- general agent (web research, structured output, tool calling, long context, fast/simple);
- embeddings and rerank.

Each profile has:
- required capabilities, which must be `tested` or `documented`;
- a minimum context;
- preferences ordered by free quota left, then reliability, quality, latency, context, cost.

**Recommender (pure, tested)**
- Builds a ranked chain per profile from approved providers (`autoConfigAllowed`) with callable models.
- Never puts a paid model in the chain unless the user enabled paid fallback (TASK-044 setting).
- Unknown remaining quota stays `UNKNOWN`. It is never treated as available.

**Applying to this app**
- The proposals map onto this app's routes and fallback chains (TASK-044).
- They appear on the new page and in the model advisor input.
- An "Áp dụng" click applies them.
- Nothing is auto-applied.

**Applying to OmniRoute (only on a user click "Cập nhật OmniRoute", with a preview diff)**
1. `POST /api/db-backups/export`. Store the backup id and time.
2. Create or update combos named `va-<profile>` (only these; never edit other combos), plus model aliases.
3. Re-run `/api/providers/{id}/test` for the previously callable connections. If any regress, show the restore steps (`/api/db-backups` restore by id) with a button, which also needs a click.
4. Write a change record and `provider-intelligence/reports/changes/<date>-omniroute.md`. It includes the backup id and the rollback steps.

**Removing expired models:** only from `va-*` combos, after a backup.

## 7b. Model abilities and benchmarks (so the operator picks the right model for each job)

Today the router knows prices, quota and simple capabilities. It does not know which model is actually **good** at each of the app's 26 `LlmTaskId`s. Add three kinds of evidence and one scorecard that combines them. Measured results from this app weigh the most. Public benchmarks weigh the least.

### 1. Ability profile per model (`ModelAbilities` in `providerIntel.ts`)

**Abilities**
- Each ability has a 1–5 grade or `UNKNOWN`, plus `source` (`app_eval` | `app_runs` | `public` | `documented`), the sample size `n`, and `measuredAt`.
- The abilities are:
  - `vietnamese_writing`, `vietnamese_understanding`, `english_writing`;
  - `reasoning`, `fact_accuracy`, `instruction_following`;
  - `structured_output` (schema-valid on the first try);
  - `tool_calling`, `long_context`;
  - `vision_detail`, `vision_ocr`;
  - `creativity_storytelling`, `summarisation`, `translation`, `classification`, `coding`.
- **Speed:** `ttft_ms` p50, `tokens_per_sec` p50.
- **Context:** the real usable context, as tested.
- **Never derive an ability from the model name or the marketing copy.**

### 2. Public benchmarks (evidence, low weight)

- **Record type:** `BenchmarkResult { modelId, benchmark, version, metric, value, sourceUrl, quote, measuredAt, source: "model_card" | "leaderboard" | "paper" }`.
- **Where the operator reads them:** official model cards and papers, and public leaderboards whose terms allow reading. Examples:
  - LMArena (text, vision, and a Vietnamese category if one exists);
  - Artificial Analysis public pages;
  - OpenRouter model pages;
  - SWE-bench, MMLU-Pro, GPQA, LiveBench and Aider pages.
- **How:** these sources go into a curated `benchmarkSources` list in code. The operator reads them through `intel_fetch_page` under the same §0 rules (robots.txt, 15 s timeout, no login, no API keys). It records results with `intel_submit_benchmark`, using the verbatim-quote rule.
- **Comparing:** compare only the same benchmark **and version**. A result older than 180 days is shown as stale and weighs half.
- **Task map:** a mapping in code from benchmarks to app abilities decides which benchmarks count for which `LlmTaskId`. For example, coding benchmarks do not count for `script`.

### 3. Real-run statistics (free: computed from existing job data, no extra calls)

**A daily code job writes the table `model_task_stats`.**

For each (provider, model, `LlmTaskId`, day) it stores:
- calls;
- success rate;
- first-try schema-valid rate;
- retries;
- fallback rate and the fallback reason;
- p50/p95 latency, tokens and cost.

**Quality signals from the pipeline, when they exist:**
- the `scriptReview` score;
- the `guidelineCheck` fails;
- `factCheck` issues per 1,000 words;
- `visionCheck` disagreement with a later stage;
- the gate result (approved, or rejected/edited by the user);
- the review-chat edit count;
- for `commentAssist`, the drafts the user sent unedited.

Attribute each signal only to the model that produced the input it judges.

**Confidence:** `low` (n < 10), `medium` (n < 50), `high` otherwise.

### 4. App eval suites (the "bench app")

**Suites**
- Small fixed suites in `packages/shared/src/modelEval/suites/*.json`, 8–15 cases each.
- They cover the app's own work, in Vietnamese where the app works in Vietnamese:
  - research summary;
  - script writing, short and long;
  - script review;
  - scene breakdown JSON;
  - image search queries;
  - vision check, with fixture images in the repo;
  - fact check, with planted errors;
  - metadata and title;
  - translation and shortening;
  - comment classification;
  - trend match;
  - assistant tool choice.
- Every case has `taskId`, `input` and `graders[]`.

**Graders**
- **Deterministic** (pure, tested):
  - schema validity;
  - required keys;
  - length window;
  - Vietnamese diacritics ratio;
  - banned phrases from the guideline packs;
  - exact or label match;
  - planted errors found;
  - tool name and arguments match.
- **LLM judge**, with a fixed rubric per suite:
  - It compares pairwise against the model currently routed for that task, swapping the order and averaging.
  - The judge model is set in settings. **A model never judges itself.** If the judge is the candidate, use the second judge in the list.
  - Judge outputs are cached by `(case, outputs hash)`.

**When evals run (cost guard)**
- An eval runs only:
  - on user request (web, Telegram, or the operator chat);
  - from a standing order;
  - when the operator wants to propose a model that has no `app_eval` data for that task.
- **Free or subscription models with quota left run directly** (risk `read`). Check the quota with TASK-044/045.
- **A paid model**, or any run over the cap (default 80 calls including judge calls; setting `modelEval.maxCallsPerRun`), becomes a pending action that shows the estimated calls and cost.
- **Never** on cookie or web-session connections.
- **Never** on the protected project or real user data. Use suite inputs only.
- **Stop rules:** stop early when quota gets near the limit. Results are stored per case, so a run can resume.
- **Tables:** `model_eval_runs` and `model_eval_results`. Generate them with `drizzle-kit generate`.

### 5. Scorecard and routing (pure, tested)

**`modelScorecard(taskId)`** ranks the candidate models for that task:
1. **Hard filters:**
   - the required capabilities are `tested` or `documented`;
   - the context is at least the task's need;
   - the provider has `autoConfigAllowed`;
   - the model is not in cool-down;
   - the model is not paid, unless paid fallback is enabled.
2. **Quality score**, 0–100, from these weights:

   | Source | Weight |
   |---|---|
   | `app_eval` | 50 |
   | real-run quality signals | 25 |
   | public benchmarks mapped to this task | 15 |
   | documented abilities | 10 |

   Missing parts drop out and lower the confidence. They are never filled with guesses.
3. **Combine with the practical factors:** quota left today, success and schema rate, latency, and cost.
   - The weights depend on the budget mode (`budget/modes.ts`): ECO favours free models with quota left; QUALITY favours the quality score.
4. **Output:** rank, score, confidence, and a short Vietnamese reason per model, for example "điểm eval 82 (n=12), dùng thật 96% thành công, còn 70% quota".

**Where the scorecard is used**
- The §7 recommender maps profiles onto the 26 `LlmTaskId`s through a `taskId → abilities` table in code, and uses the scorecard to order each fallback chain.
- The model advisor (`modelAdvisor.ts`) gets the scorecard rows in its catalog input.
- Route changes are still only proposals. They apply only on the user's click or through an approved pending action.

### 6. The operator's model duties (registered in the handbook)

**Weekly**
- Read the scorecards.
- For each task where a clearly better model with quota exists, propose a route change with the evidence. "Clearly better" means ≥ 8 points better with at least medium confidence, or the current model is failing.

**When a new model or provider appears**
- Run the relevant suites on it (free models only) before proposing it.

**When real-run stats drop**
- If the success rate falls by ≥ 15 points or latency doubles, investigate and propose a fallback.

**Every proposal goes to Telegram** with Duyệt/Từ chối buttons.

## 8. UI: the page "Nhà cung cấp AI" (`/providers`, linked in the sidebar near "Mô hình AI")

**Tabs**
1. **Tổng quan**: the answers to the 10 audit questions of the addendum (§7 of the user brief), each with links into the details:
   - which providers are registered;
   - which are callable;
   - which have free quota;
   - unused benefits;
   - cloud extras;
   - what works for a Vietnamese individual;
   - what needs a card or KYC;
   - what expires soon;
   - what is useful for the projects;
   - what is safe to activate with no spending.
2. **Đang dùng trong OmniRoute**: one row per connection with:
   - the status chips (the addendum states);
   - models;
   - last success;
   - errors;
   - free/paid/promo/unknown;
   - "Kiểm tra lại".
3. **Danh mục nhà cung cấp**:
   - a sortable table: score, risk flags as red chips (never hidden by a high score), legitimacy, Vietnam, the best offer, billing risk;
   - filters: no card, free API, Vietnam OK;
   - a detail drawer with every section and its evidence links and dates.
4. **Ưu đãi & lợi ích**:
   - active, expiring, and expired offers;
   - the ecosystem matrix;
   - "Lợi ích chưa dùng" grouped by eligibility;
   - activation steps in Vietnamese.
5. **Rủi ro thanh toán**:
   - the compact per-provider summary from the billing addendum §9;
   - the 10 answers;
   - the safest zero-spend config;
   - the user checklist form ("Tôi đã kiểm tra trên dashboard", per field, with a date).
6. **Định tuyến**:
   - the profile chains;
   - the proposed changes for the app and for OmniRoute;
   - the apply buttons;
   - the backup/rollback history.
7. **Thay đổi cần xem**: the `needsReview` diffs, with "Đã xem".

All text is in Vietnamese.

### Extra tab: "Năng lực & benchmark"

- **Matrix:** models × the app's tasks. Each cell shows the score, a confidence chip, and a ✓ for the current route.
- **Click a cell** for the breakdown: the eval cases, the real-run stats and the public benchmarks with their sources.
- **Eval run history.**
- **The "Chạy đánh giá" button**, with an estimate of the calls and quota it will use.

## 9. Registry tools (TASK-047 registry, so the operator, the assistant and MCP all get them)

### Read tools (risk `read`)

- `get_provider_intel_summary`
- `get_provider(providerId)`
- `get_billing_risk(providerId)`
- `list_intel_changes(needsReview)`
- `list_offers(status)`
- `get_omniroute_audit`
- `get_routing_proposals`

### Writing research (risk `read`, because it only stores text that is verified and versioned)

**`intel_fetch_page(url, providerId, pageKind)`**
- The app fetches the page, following the §0 rules: official domains only, `robots.txt`, timeout, at most 1 fetch per URL per 6 h.
- It stores the normalised text and its hash, and returns the text (truncated to 60k characters) plus a `pageId`.
- The official domain list for each provider comes from its record. A fetch to a new domain needs the provider's `website` to be set first.

**`intel_submit_assessment(providerId, section, fields[])`**
- Each field is `{ path, value, pageId, quote }`.
- The app keeps a value only when `quote` occurs verbatim in that `pageId`'s stored text.
- Fields that fail verification become `UNKNOWN`. The response lists them.
- Every accepted field becomes a new version with `needsReview: true`.
- It never overwrites `user_checked` fields.

**Other research tools**
- `intel_add_provider_stub(name, website, categories, discoveredFrom)`
- `intel_set_offer(...)`, using the same quote rule
- `intel_run_job(kind)`, where kind is `daily` | `weekly` | `monthly` | `audit` | `probes` | `export`, and probes keep their §0 limits
- `intel_write_report(kind, markdownVi)`, which is saved under `reports/`

### Model abilities and benchmarks (§7b)

- **Read:**
  - `get_model_abilities(modelId)`
  - `get_model_scorecard(taskId)`
  - `compare_models(taskId, modelIds[])`
  - `get_model_task_stats(taskId, days)`
  - `list_eval_suites`
  - `get_eval_run(runId)`
- **Writing evidence:** `intel_submit_benchmark(...)`, using the quote rule.
- **Running evals:** `run_model_eval(suiteIds[], modelIds[])`.
  - It runs directly only within the §7b cost guard.
  - Otherwise it returns a pending action.
- **Confirm:** `propose_route_change(taskId, chain, reasonVi)`.

### Confirm tools (risk `confirm`, so they become pending actions the user approves)

- `apply_routing_proposal`
- `update_omniroute_combos`, which follows the §7 sequence: backup, writes only to `va-*` combos, re-test, rollback info
- `mark_change_reviewed`

The operator can propose these but never approve them.

### Standing orders the app seeds

The app seeds these standing orders for the operator (TASK-047 `standing-orders`). They are off until the user turns them on.

- **Full research of every current provider** (one-off, seeded **enabled**, because the user asked for it):
  - "Nghiên cứu toàn bộ provider hiện có".
  - Scope: every connection in the OmniRoute audit, every provider the app's routes and quota rules use, and every seeded stub.
  - The app keeps a research queue (`provider_intel_research_queue`: providerId, status `todo|doing|done|failed`, attempts, lastRunAt). Each operator run takes the next batch (as many as fit in one run, default 4), and the app chains the next run automatically through `wakeOperator` until the queue is empty. Runs still respect the queue, the kill switch and `maxRunsPerDay`. When the daily cap is reached, the run continues the next day.
  - Tools: `intel_next_research_batch()` returns the next providers with what is missing; `intel_mark_researched(providerId, status, noteVi)`.
  - At the end, the operator writes the full report (`intel_write_report("full", …)`) and the app sends the Telegram summary below.
- **Weekly, Monday 09:00** (off until the user turns it on):
  1. "Tìm nhà cung cấp/ưu đãi mới" (new ones go into the research queue).
  2. "Nghiên cứu lại tất cả provider `needs_research` hoặc dữ liệu quá 30 ngày" (queued and batched the same way, with no cap on the total).
  3. "Viết báo cáo tuần"
- **Monthly, day 1:** "Rà ToS/privacy/billing các provider có thay đổi `needsReview`"
- **Daily:** the code job only, with no operator run. The operator is woken only when the daily job finds changes or credits expiring within 7 days.

The user can also ask at any time in chat, either on the web or on Telegram.

### Telegram notifications

Use the existing notification service and the existing bot and chat. Messages are in Vietnamese, short, and redacted.

- **Research progress:** one message per completed batch, "Đã nghiên cứu 4/23: …". A setting can mute it.
- **Full or weekly report done:**
  - the top 5 providers for a Vietnamese individual;
  - the `BILLING_UNVERIFIED` and HIGH/CRITICAL billing-risk providers;
  - the manual steps for the user;
  - the link to `/providers`.
- **Immediately**, as kind `attention`:
  - a provider becomes HIGH/CRITICAL billing risk;
  - a ToS, privacy or billing change needs review;
  - free credit expires within 7 days;
  - a routing proposal or OmniRoute update waits for approval. Send it with inline Duyệt/Từ chối buttons from TASK-047, which only the user can press.

## 10. Tests (no network)

**Schemas and seed**
- The stubs and fixtures pass zod.
- Every non-UNKNOWN fact has a URL and a date.

**Model abilities and benchmarks**
- The deterministic graders work, one case each.
- The judge never judges itself and the order is swapped.
- The eval cost guard:
  - free models with quota left run directly;
  - a paid model, or a run over the cap, creates a pending action;
  - cookie connections are refused;
  - the run stops near quota.
- `model_task_stats` aggregation from fixture jobs, with signals attributed to the right model.
- The scorecard:
  - the weights apply, and a missing source lowers the confidence instead of scoring;
  - ECO and QUALITY order models differently;
  - the hard filters apply.
- Benchmark versions are not mixed, and stale results weigh half.
- The suites pass zod. Every `LlmTaskId` that uses a model is in the `taskId → abilities` map.

**Research tools**
- `intel_submit_assessment` keeps a value whose quote is in the stored page.
- It turns a value with a missing or altered quote into `UNKNOWN`.
- It never overwrites `user_checked` fields.
- `intel_fetch_page` refuses non-official domains and enforces the 6 h limit.
- The confirm tools create pending actions when called from the operator.
- The seeded standing orders are off by default, except the one-off full research.
- The research queue chains runs until it is empty and stops at `maxRunsPerDay`.
- Telegram messages are sent for a batch, the report, and risk changes (mock the notifier).

**Scoring and flags**
- The scorer and its weights.
- `UNKNOWN` scores 0.
- The flags block auto-config.
- The billing risk rules and `BILLING_UNVERIFIED`.
- `UNKNOWN` exhaustion is never `HARD_STOP`.

**Storage**
- Append-only versioning: an update keeps the old version.
- Expired offers move, not delete.

**Safety**
- Redaction: keys, tokens, cookies, and emails are removed from exports and logs. Spy on the logger.
- The quote verification drops values whose quote is not in the page text.
- The page-diff job: a changed hash → `needsReview` + a notification; no change → nothing.

**OmniRoute audit** (mocked API)
- The state mapping covers each state.
- `needs_token`.
- Cookie connections are never probed.
- One probe per model per day.

**OmniRoute writes** (mocked)
- The backup comes first. If the backup fails, there are no writes.
- Only `va-*` combos are touched.
- A regression shows the rollback.

**Recommender**
- Capabilities must be tested or documented.
- No paid entry without the setting.
- An unknown quota is not "available".

**Exports**
- The files are written with the expected names.

**Web**
- The overview renders.
- Risk chips are visible on a high-score provider.
- The checklist saves.
- The apply buttons need a click and show the diff.

## 11. Live check

1. Run the OmniRoute audit against the real local OmniRoute. If no management token is saved, the result is `needs_token`; that is expected. Do not create a token.
2. Run the daily job once. Each official page gets one fetch.
3. In the operator chat, ask "Nghiên cứu Scaleway và DeepSeek theo quy trình provider intel". Check that the stored fields have verified quotes, and that the fields the operator could not verify are `UNKNOWN`.
4. Through the operator, run one eval suite (`metadata`) on two **free** models with quota left: "so sánh 2 model miễn phí cho metadata". Check the scorecard and the Telegram summary. Do not apply the route.
5. Check the page and the exported `provider-intelligence/` files. Then grep the exports for `sk-`, `oma_`, `Bearer`, and `@`; there must be no secrets.
6. **Do not** click "Cập nhật OmniRoute" and do not apply routing. Show only the preview.
7. Attach screenshots.

## Done

Use the done checklist from the README.

Write `docs/tasks/TASK-046.report.md`. Besides the usual sections, it includes:
- a short table of the top providers for a Vietnamese individual, with no card required;
- the providers marked `BILLING_UNVERIFIED`;
- the manual steps left for the user.

Create `docs/tasks/TASK-046.done`.
