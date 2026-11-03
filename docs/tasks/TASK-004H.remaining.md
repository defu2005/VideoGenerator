# TASK-004H — remaining work (handover from agy)

The full spec is `docs/tasks/TASK-004H.md`. A previous implementer (Antigravity CLI) ran out of quota partway through. **Keep its work and finish it. Do not rewrite it.**

## Already in the working tree (uncommitted, review and keep)
- `apps/server/src/providers/llm/antigravityCli.ts`: provider, args, parsing, failure classes, `agy models`.
- `apps/server/test/antigravityCli.test.ts`: 36 tests.
- Fixtures `apps/server/test/fixtures/agy-1.4.12-*`.
- Config entries in `apps/server/src/lib/config.ts` and `.env.example`, `antigravity-cli` in `LlmProviderIdSchema`, and registry wiring.
- Typecheck passes. Server tests are 214/215.

## Still to do
1. **Fix the flaky test** `resolveAgyPathWithRetry > returns null quickly when binary never found and maxRetryMs is small`. It fails with `expected 2002 to be less than 2000`. Make the timing assertion robust: use fake timers, or a generous bound that still proves "quick". Do not just delete the test.
2. **JSON schema** (spec §1, Invocation):
   - Add an optional `jsonSchema` object to `LlmRequest`.
   - Make `generateStructured` (or its equivalent) fill it from the zod schema with `z.toJSONSchema`.
   - In the agy provider, when `json: true` and `jsonSchema` is set, write it to the per-call temp dir and pass `--json-schema <file>`.
   - Other providers ignore the field.
   - Add tests.
3. **Pricing**: in `apps/server/src/providers/llm/pricing.ts`, `antigravity-cli` must cost $0, the same as `claude-cli` and `copilot-cli`. Add a test.
4. **UI** (spec §4), in `Cài đặt → Mô hình AI` (`apps/web/src/features/settings/AiSettingsPage.tsx` and the server provider list):
   - Label "Antigravity CLI (tài khoản Google)".
   - Hint "Cài agy và chạy `agy` một lần để đăng nhập Google".
   - Presets: "Nhanh" uses `gemini-3.8-flash-low`, "Mạnh" uses `claude-sonnet-4-6`.
   - Status: Đã cài / Chưa cài, the sign-in state from the last call's classification, and monthly calls.
   - Update the web tests. The layout must work at 375, 768 and 1280 px.
5. **Check the acceptance unit-test list** (spec, Acceptance criterion 2). Add any coverage that is missing.
6. **Report**: write `docs/tasks/TASK-004H.report.md` and create an empty `docs/tasks/TASK-004H.done`.

## Rules (unchanged)
- Do not run `agy`, `claude`, or `copilot`, and do not touch the network in tests.
- Do not add dependencies.
- Do not hand-write migrations (none are expected).
- Do not commit or push.
- Do not use `--dangerously-skip-permissions` or any mode other than `plan` in app code.
- Before writing the report, run `npm run typecheck`, `npm run build` and `npm test` from the repo root. All must pass.
