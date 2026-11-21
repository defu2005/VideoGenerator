// TASK-085: shared tool types and defineTool. Import from here or from registry/tools/index.ts.
import type { AssistantToolRisk } from "@vg/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { AppDatabase } from "../../db/client.js";
import type { AppConfig } from "../../lib/config.js";
import type { LlmProviderRegistry } from "../../providers/llm/registry.js";
import type { AutomationService } from "../../services/automationService.js";
import type { ProfileService } from "../../services/profileService.js";
import type { ProjectService } from "../../services/projectService.js";
import type { TopicService } from "../../services/topicService.js";
import type { UsageService } from "../../services/usageService.js";
import type { PipelineOrchestrator } from "../../pipeline/orchestrator.js";
import type { PublishService } from "../../publishing/publishService.js";
import type { SceneService } from "../../services/sceneService.js";
import type { AnalyticsSyncService } from "../../analytics/syncService.js";
import type { FinanceService } from "../../finance/financeService.js";
import type { LearningService } from "../../learning/learningService.js";
import type { ClipService } from "../../services/clipService.js";
import type { CommentInboxService } from "../../comments/inboxService.js";

export type AssistantToolContext = {
  agentStages?: import("../../agents/stageService.js").AgentStageService;
  agentVisuals?: import("../../agents/visualToolkit.js").AgentVisualToolkit;
  agentResearch?: import("../../agents/researchToolkit.js").AgentResearchToolkit;
  agentMusic?: import("../../agents/musicToolkit.js").AgentMusicToolkit;
  /** TASK-147d: SCRIPT stage agent submit gate. */
  agentScript?: import("../../agents/scriptToolkit.js").AgentScriptToolkit;
  /** TASK-139: fast previews. */
  preview?: import("../../preview/service.js").PreviewService;
  research?: import("../../research/runtime.js").ResearchHub;
  db: AppDatabase;
  sqlite: Database.Database;
  config: AppConfig;
  agent?: {
    kind: string; name: string; model: string | null; environment: string;
    /** TASK-122: `kind/name`, from the machine key. */
    instance?: string;
    canSupervise?: boolean;
  };
  profiles: ProfileService;
  projects: ProjectService;
  topics: TopicService;
  automation: AutomationService;
  orchestrator: PipelineOrchestrator;
  publish: PublishService;
  usage: UsageService;
  registry: LlmProviderRegistry;
  scenes: SceneService;
  analytics?: AnalyticsSyncService;
  finance?: FinanceService;
  learning?: LearningService;
  clips?: ClipService;
  comments?: CommentInboxService;
  trends?: import("../../trends/trendService.js").TrendService;
  translations?: import("../../translations/translationService.js").TranslationService;
  /** TASK-119: worker machines. Join tokens, revoke and version pin are not reachable from here. */
  nodes?: import("../../node/nodeService.js").NodeService;
  /** Read-only view of Kết nối and platform accounts. Never exposes a key. */
  connections?: ConnectionsReader;
  signal?: AbortSignal;
  /** Operator run that made the call, when there is one. */
  runId?: string | null;
  /** TASK-152: one id per chat send, used only to count shadow rows once per turn. Not an operator run; Computer Use and audit never read it. */
  turnId?: string | null;
  /** True when a grant ran the tool without a pending card. Never taken from tool arguments. */
  autonomyRun?: boolean;
  /** True for an unattended grant or an MCP agent call. User clicks and approved cards stay false. */
  gated?: boolean;
};

export type ConnectionsReader = {
  overview: () => import("@vg/shared").ConnectionsOverview;
  accounts: () => import("@vg/shared").AccountListRow[];
};

export type AssistantToolDef = {
  name: string;
  description: string;
  risk: AssistantToolRisk;
  argsSchema: z.ZodTypeAny;
  summarize: (args: unknown) => string;
  execute: (args: unknown, ctx: AssistantToolContext) => Promise<unknown>;
};

export function defineTool(def: AssistantToolDef): AssistantToolDef {
  return def;
}
