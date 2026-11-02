# TASK-004D Implementation Report

## Summary

Implemented configurable provider token limits and preflight checks, shared CLI-provider process handling, the `copilot-cli` provider, monthly provider-call reporting, UI usage/limit hints, and VS Code Copilot Chat MCP setup documentation.

**GitHub Models was not implemented.** GitHub's current official documentation says the playground, model catalog, inference API, and BYOK were fully retired on July 30, 2026: [GitHub Models retirement notice](https://docs.github.com/en/github-models). Consequently, there is no currently usable base URL, authentication contract, or model ID format to verify or ship. The in-workspace TASK-004D amendment also explicitly says not to ship this provider.

## Implementation

- Added optional `maxInputTokens` and `maxOutputTokens` metadata and environment overrides for configured providers. Structured requests clamp output tokens to the provider limit.
- Added the conservative character-based token estimator and preflight checks for script output, merged/separate decisions, input limits, and research trimming. Providers without limits retain their prior behavior.
- Extracted CLI process handling into `cliProvider.ts`; `claude-cli` now uses the shared base. Added `copilot-cli` using stdin, a temporary empty working directory, no available tools, and no system-temp access.
- Copilot CLI missing-binary, authentication, and exhausted-quota errors are mapped to non-retryable errors. Unreported token usage is stored as zero with `tokensUnknown: true`; CLI subscription cost remains zero.
- Jobs now persist provider/model usage metadata. `GET /api/llm/providers` reports each provider's current-month call count from job usage. The count is informational only; it does not cap or block calls.
- Updated the provider selector and Script tab usage display. Added Copilot Chat MCP setup instructions; no `.vscode/mcp.json` was created.
- No database migration or dependency was needed.

## Copilot CLI verification

The task identifies the installed CLI as version **1.0.105**. I inspected `copilot --help` and `copilot help permissions`; no prompts were run. The official quickstart documents non-interactive `-p` and silent `-s` use: [GitHub Copilot CLI quickstart](https://docs.github.com/en/copilot/get-started/cli-quickstart).

Final arguments, with stdin carrying the formatted system and user prompt:

```text
-p -s --output-format json --disable-client-telemetry
--available-tools --disallow-temp-dir
--log-dir <empty temporary working directory> --log-level none
[--model <configured model>]
```

`--available-tools` is supplied with an empty list; `--allow-all-tools` is never passed. On Windows, the npm command shim resolves to its `npm-loader.js` and is launched by Node directly, without a shell. Copilot CLI behavior is tested with a fake executable only.

## Files changed

- Server LLM provider types, registry, configuration, CLI providers, token estimator, preflight, structured generation, pricing, API route, orchestrator, and research/script stages.
- Shared LLM provider and job-usage schemas.
- Web project provider selector and Script tab usage display.
- `.env.example`, `README.md`, and `docs/CLAUDE_DESKTOP.md`.
- Server tests for configuration, provider registry and API usage counts, CLI behavior, preflight, stages, structured output limits, and subscription pricing; web usage-display test.

The architecture/task files also contain the in-progress retirement amendment; it was preserved.

## Validation

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run build` | Passed; Vite reported existing non-fatal Zod/Rollup annotation warnings |
| `npm test` | Passed: MCP 5/5, server 95/95, web 25/25 (**125 tests total**) |

Fake-binary tests cover Copilot CLI JSONL and plain-text handling, unknown token usage, authentication/quota error mapping, and abort termination. Existing Claude CLI tests pass unchanged. Preflight stage tests cover a 120-second merged call, a 600-second two-call switch, and an 1800-second pre-call rejection using a limited mock provider.

## Deviations and remaining issues

- GitHub Models endpoint, auth, permission, and model-ID details were intentionally not implemented or reported as current because the service is retired. The historical API cannot be validated against a live service.
- No real Copilot CLI prompts or quota-consuming requests were made.
- No commit was created.

## Architect verification
- 125/125 tests (MCP 5, server 95, web 25); `npm audit --omit=dev` = 0; no new dependencies; no github-models code (service retired 2026-07-30).
- Verified every Copilot CLI flag exists in `copilot --help` (1.0.105): `-p -s --output-format json --disable-client-telemetry --available-tools (empty) --disallow-temp-dir --log-dir --log-level`. Spawn uses `shell:false`; Windows kill uses `taskkill /T /F`; npm-loader.js path resolves on this machine.
- Live server with `COPILOT_CLI_ENABLED=true`: `/api/llm/providers` lists `copilot-cli` configured with `usage.monthCalls`; no prompt was run (quota preserved). Real prompt test pending `copilot login` by the user.
