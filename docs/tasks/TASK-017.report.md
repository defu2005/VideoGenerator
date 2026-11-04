# TASK-017 Report

## Implementation

Content guideline packs now run on the server and show up in the web app. The shared pack, resolve, and check layer was already in place and was left in place, except one response field noted below.

REMIND appends `guidelinePromptBlock` into the research, script, review, merged-story, scene-query, and alt-query prompts. FILTER adds code checks after SCRIPT and TIMELINE, plus one `guidelineCheck` call when the budget is not `off`. QUALITY (`checkAndFix`) may add one extra script review and one recheck when the first check returns a MUST finding. Those LLM errors are logged and do not fail the stage. An open MUST finding stops AUTO auto-approve; manual approval still works. Licenses stay metadata.

App settings store user packs (`guidelinePacks`) and profiles (`guidelineProfiles`). A default profile is applied only when create does not send `settings.guidelines`.

## Files

Shared (already present, plus the response field and tests):

- `packages/shared/src/guidelines/{schema,packs,resolve,checks}.ts`
- `packages/shared/src/{index.ts,budget/modes.ts,schemas/llm.ts,schemas/project.ts}`
- `packages/shared/test/{guidelines,budget,llm}.test.ts`

Server:

- `apps/server/src/db/schema.ts`
- `apps/server/drizzle/0014_guideline_findings.sql`
- `apps/server/drizzle/meta/0014_snapshot.json`
- `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/guidelines/{service,settings,promptText,llmCheck}.ts`
- `apps/server/src/api/guidelines.ts`
- `apps/server/src/{app.ts,pipeline/orchestrator.ts,services/projectService.ts,services/visualService.ts,providers/llm/mock.ts}`
- `apps/server/src/api/{script,recommendations}.ts`
- `apps/server/src/stages/research/{prompt,researchExecutor}.ts`
- `apps/server/src/stages/script/{prompt,reviewPrompt,mergedStoryPrompt,scriptExecutor}.ts`
- `apps/server/src/stages/scenes/{sceneQueryPrompt,scenePlanExecutor}.ts`
- `apps/server/src/stages/visuals/altQueryPrompt.ts`
- `apps/server/src/stages/timeline/timelineExecutor.ts`
- `apps/server/test/{guidelines,budget,projects,researchScript,scriptApi,pipelineFixtures}.test.ts`

Web:

- `apps/web/src/services/guidelinesApi.ts`
- `apps/web/src/features/projects/{GuidelineFieldset,GuidelineFieldset.test}.tsx`
- `apps/web/src/features/projects/{ProjectFormFields,CreateProjectDialog,EditProjectDialog,BriefFields}.tsx`
- `apps/web/src/features/guidelines/{GuidelineFindings,GuidelineFindings.test,GuidelineSettingsPage}.tsx`
- `apps/web/src/features/script/ScriptTab.tsx`
- `apps/web/src/features/timeline/TimelinePanel.tsx`
- `apps/web/src/{App.tsx,index.css,components/layout/AppLayout.tsx}`
- Project fixtures and budget-copy tests under `apps/web/src/features/**`

MCP:

- `apps/mcp/src/{apiClient,tools}.ts`
- `apps/mcp/test/tools.test.ts`

## Migration

Generated from `apps/server` with `npx drizzle-kit generate` (not hand-edited). A later `npx drizzle-kit generate --name guideline_findings_again` printed `No schema changes, nothing to migrate`.

## Tests

| Workspace | Last commit | Now |
| --- | ---: | ---: |
| shared | 150 | 156 |
| mcp | 10 | 11 |
| server | 291 | 295 |
| web | 68 | 70 |

`npm run typecheck`, `npm run build`, and `npm test --workspaces` passed.

## Existing tests that changed on purpose

Default parsed projects get platform `youtube`, style `storytelling`, and tone `dramatic`, so BALANCED and QUALITY script runs make one extra `guidelineCheck` call. `researchScript` expected call counts and `guidelineCheck: 1` usage were updated. ECO still makes no guideline call; the merged early return omits `features` when that map is empty, so the ECO usage shape stays without a `features` key.

Budget totals grew by the guideline call. QUALITY estimate is now total 7–24 and SCRIPT 4–18. A BALANCED project with legacy `researchMode: merged` estimates 5–9. The web copy for a default BALANCED project is `~6–11`. CUSTOM with review passes 0 / 2 is `~5–9` / `~7–13`. The usage-panel fixture now includes `guidelineCheck: "check"` so `BudgetEstimateSchema` still parses.

The shared music prompt-block test uses platform `custom` plus the storytelling pack, because the YouTube pack has a music license rule.

## Deviations

- `GuidelineFindingsResponseSchema` now requires `needsAttentionSceneIds`. The guide asked for that derived field; the architect schema did not have it. It is computed from open MUST findings and is not a column.
- `checkAndFix` stores the recheck findings. The first MUST row is marked FIXED when the second check returns a different set. A second provider call happens when the fix review changes the script; an identical script is served from the LLM cache.
- On-demand `POST /guidelines/check` runs code checks whenever a script or timeline exists, including under REMIND, and runs the LLM check whenever a script exists and the budget is not `off`.
- The script prompt endpoint still asks for research depth `"standard"`, as it did before this task.
- `musicAssist` and `metadata` prompts do not exist yet. Guidance was not added there.

## Not done

- No commit and no push.
- TASK-019, TASK-018, and the later cursor tasks were not started.
- Files already dirty for OmniRoute, OpenCode, and the agy helper (`.env.example`, `apps/server/src/lib/config.ts`, `apps/server/src/providers/llm/registry.ts`, `apps/server/test/llmProviders.test.ts`, `scripts/agy-task.ps1`, `docs/cursor/`, `docs/tasks/TASK-019.md`, `docs/tasks/TASK-017.agy-prompt.md`) were left as they were.

## Browser

Checked on `http://127.0.0.1:5180` with the API already listening on port 3001. Settings at `/settings/guidelines` lists the built-in packs; Nhân bản opens an editable copy and Xoá gói removes that unsaved copy. A throwaway project (`TASK-017 throwaway`, budget ECO, strictness FILTER) showed the fieldset (platform packs, channel checkboxes, FILTER, YouTube rules) and a CODE finding for `youtube.profanity` on the Script tab. Bỏ qua with a reason cleared the open finding. Kiểm tra lại was not used after a script existed under a non-mock provider. The throwaway project was deleted afterward (HTTP 204). The project `56374fb2-54cf-48ff-9441-2e6c653295d4` was not opened, approved, or rendered.
