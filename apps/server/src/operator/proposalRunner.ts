import type Database from "better-sqlite3";
import { z } from "zod";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { digestProject } from "./digestLine.js";
import type { DraftRunner } from "./proposalDraft.js";

// TASK-074c-3c-2b: the real draft runner. One routed request per draft: no repair (repairAttempts 0), no separate
// fallback logic of its own (the routed path decides failover), no gateway override and no pre-check of its own. The
// spend-limit gate still applies inside generateRoutedStructured, because the cache passes sqlite through. The model
// returns the body as JSON { markdown }; the file is written by proposalWriter, not here.
// LlmError (truncation, invalid output, provider failure) propagates unchanged so draftProposal leaves the row accepted.

export const PROPOSAL_MAX_OUTPUT_TOKENS = 4096;
export const PROPOSAL_TIMEOUT_MS = 120_000;

const ProposalDraftOutput = z.object({ markdown: z.string().min(1) }).strict();

const SYSTEM = [
  "Bạn soạn bản nháp guide cho một công cụ còn thiếu của hệ thống video.",
  "Trả về JSON đúng dạng {\"markdown\": \"...\"}; markdown là nội dung guide tiếng Việt theo mẫu docs/cursor/TASK-*.md:",
  "phạm vi, mã nguồn mở có sẵn, dữ liệu và code, các bước, test, checklist.",
  "Không ghi lệnh git, không yêu cầu khởi động Codex hoặc Cursor trên repo, không sửa mã nguồn app.",
].join(" ");

export function createProposalRunner(deps: { registry: LlmProviderRegistry; sqlite: Database.Database }): DraftRunner {
  return async (request) => {
    const route = deps.registry.resolveTask("operatorPlan", digestProject(), getAppLlmSettings(deps.sqlite));
    const generated = await generateRoutedStructured({
      registry: deps.registry,
      route,
      task: "operatorPlan",
      schema: ProposalDraftOutput,
      schemaName: "ProposalDraft",
      schemaVersion: "1",
      system: SYSTEM,
      prompt: JSON.stringify(request),
      maxOutputTokens: PROPOSAL_MAX_OUTPUT_TOKENS,
      repairAttempts: 0,
      signal: AbortSignal.timeout(PROPOSAL_TIMEOUT_MS),
      cache: new LlmCache(deps.sqlite, false),
    });
    return generated.value.markdown;
  };
}
