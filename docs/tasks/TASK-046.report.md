# TASK-046 report — Provider intelligence

## What changed

The previous run left the feature in the working tree. This run kept that work, filled the remaining gaps, and verified it.

### Shared
- `packages/shared/src/schemas/providerIntel.ts` — evidenced facts, offers, billing, accounts, models, abilities, benchmarks
- `packages/shared/src/providerIntel/` — scorer, billing risk, routing profiles, scorecard, seed stubs, feed discovery
- `packages/shared/src/modelEval/` — suites, deterministic graders, eval cost guard, task-stat aggregation
- `packages/shared/src/schemas/llm.ts`, `packages/shared/src/budget/modes.ts` — task `providerIntelExtract` (off in ECO, on in BALANCED/QUALITY/MAX)
- `packages/shared/src/features/featureMap.ts`, `packages/shared/src/operator/redact.ts`
- Tests: `packages/shared/test/providerIntel.test.ts`, `modelEval.test.ts`, `llm.test.ts`, `budget.test.ts`

### Server
- `apps/server/src/db/schema.ts` — `provider_intel_records`, `provider_intel_pages`, `provider_intel_probes`, `provider_intel_changes`, `provider_intel_research_queue`, `model_task_stats`, `model_eval_runs`, `model_eval_results`
- `apps/server/drizzle/0039_past_madrox.sql` and `apps/server/drizzle/meta/0039_snapshot.json`. A later `npx drizzle-kit generate` printed `No schema changes, nothing to migrate`.
- `apps/server/src/providerIntel/` — append-only store, page fetch, quote check, jobs, OmniRoute audit, combo update, export, registry tools
- `apps/server/src/api/providerIntel.ts`, `apps/server/src/app.ts`, operator standing orders, assistant tool list
- `apps/server/src/providers/llm/mock.ts` — `ProviderIntelExtract` answer
- `apps/server/test/providerIntel.test.ts`, `apps/server/test/assistant.test.ts`

### Web
- `apps/web/src/features/providers/ProvidersPage.tsx` — `/providers`, eight tabs
- `apps/web/src/services/providerIntelApi.ts`, nav, `App.tsx`, `BriefFields.tsx`
- `apps/web/src/features/providers/ProvidersPage.test.tsx`

### Docs and export folder
- `docs/user-guide/mo-hinh-ai.md`, `an-toan.md`, `nhat-ky-thay-doi.md`
- `provider-intelligence/README.md`
- `.gitignore` ignores `provider-intelligence/monitoring/` and `provider-intelligence/reports/`

No new npm dependencies. No commit.

## Test counts

| Workspace | Tests |
|---|---|
| shared | 302 |
| mcp | 14 |
| server | 635 |
| web | 143 |

`npm run typecheck` and `npm run build` passed. Changed files have no NUL bytes.

## Top providers for a Vietnamese individual, no card

No provider has a verified fact yet. The catalog is 34 stubs with `needs_research: true`. A value without a quote stays UNKNOWN, and UNKNOWN is not treated as safe. There is no ranked “no card” list until the operator records quotes.

| Provider | Card | Vietnam | Note |
|---|---|---|---|
| — | — | — | Chưa có hồ sơ đã kiểm chứng |

## BILLING_UNVERIFIED

Every seeded stub starts unverified. That includes the OmniRoute-likely names (GitHub Copilot, Antigravity, Claude, Codex, Gemini, OpenRouter, Groq, Cerebras, Mistral, Cohere, Cloudflare Workers AI, SambaNova, Together, Hugging Face), the prior list (BytePlus ModelArk, Volcengine Ark, LongCat, DeepSeek, AI21, Hyperbolic, Nscale, DeepInfra, Fireworks, Nebius, Scaleway, Novita), and eight extra stubs (Replicate, Fal, ElevenLabs, Stability, Runway, Modal, Lambda, xAI). `autoConfigAllowed` stays false while billing is unverified.

## Manual steps left for the user

1. Create a read-only OmniRoute management token and paste it on the Quota tab. The app does not create one. Without it, the audit says `needs_token`.
2. The one-off standing order “Nghiên cứu toàn bộ provider hiện có” is seeded on. The weekly and monthly orders stay off until you enable them.
3. After you look at a provider dashboard yourself, press **Tôi đã kiểm tra trên dashboard**. The app does not log in or accept terms.
4. Read the diff before **Áp dụng** or **Cập nhật OmniRoute**. A failed backup means no combo write.
5. Do not treat UNKNOWN exhaustion as a hard stop.

## Deviations

- The weekly timer runs LLM extraction only when the mock provider is enabled. A real CLI is not started by the timer. The operator can call `intel_extract_page`; quotes that are not in the stored page are dropped.
- An OmniRoute connection whose provider has no official website yet becomes a `needsReview` row. The app does not invent a website.
- The server scorecard ranks whatever model ability rows exist. There are none until research or evals store them. The pure scorecard is tested with fixtures.
- New tools share the assistant catalog, so the compact-catalog test cap moved from 12,000 to 15,000 characters. `LLM_TASKS` length moved from 26 to 27 because `providerIntelExtract` was added.
- Risk notices use the existing `automation_warning` event, which already follows the attention toggle. A route change proposed by the operator becomes a pending action with Duyệt/Từ chối. The operator cannot approve it.

## What is not done

- No live operator session researched Scaleway or DeepSeek, and this run did not fetch official provider pages.
- **Cập nhật OmniRoute** and route apply were not clicked. No screenshots.
- There is no in-browser click driver in this session. The page test clicks the catalog, the risk chip, the checklist, and Áp dụng. A throwaway API on port 3017 (its own database) returned 34 providers and 10 overview answers, saved `billing.cardRequired` as `user_checked` / `no`, and the audit returned `needs_token` with the setup steps. The user’s database and project `56374fb2-54cf-48ff-9441-2e6c653295d4` were not modified.
