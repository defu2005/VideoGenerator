import { LlmProviderIdSchema, type LlmProviderId, type LlmProviderInfo, type LlmRoute, type LlmSelection, type LlmSettings, type LlmTaskId, type Project } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCliProvider, resolveClaudeCliPath } from "./claudeCli.js";
import { CopilotCliProvider } from "./copilotCli.js";
import { resolveCopilotCliLaunch } from "./cliProvider.js";
import { GeminiProvider } from "./gemini.js";
import { MockLlmProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import { LlmError, type LlmProvider } from "./types.js";

export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider & { configured?: boolean; hint?: string }>();
  private readonly modelCache = new Map<string, { expiresAt: number; models: string[] }>();

  constructor(private readonly config: AppConfig) {
    const timeoutMs = Math.min(config.LLM_TIMEOUT_MS, Math.max(1, config.STAGE_TIMEOUT_MS - 1));
    if (config.ANTHROPIC_API_KEY) {
      this.addProvider(new AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL || null, timeoutMs));
    }
    if (config.GEMINI_API_KEY) {
      this.addProvider(new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL || null, timeoutMs));
    }

    if (config.OPENAI_API_KEY) this.addCompatible("openai", "OpenAI", config.OPENAI_BASE_URL, config.OPENAI_API_KEY, config.OPENAI_MODEL);
    if (config.OLLAMA_BASE_URL) this.addCompatible("ollama", "Ollama", config.OLLAMA_BASE_URL, undefined, config.OLLAMA_MODEL, false);
    if (config.OPENROUTER_API_KEY) this.addCompatible("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", config.OPENROUTER_API_KEY, config.OPENROUTER_MODEL);
    if (config.DEEPSEEK_API_KEY) this.addCompatible("deepseek", "DeepSeek", "https://api.deepseek.com/v1", config.DEEPSEEK_API_KEY, config.DEEPSEEK_MODEL);
    if (config.GROQ_API_KEY) this.addCompatible("groq", "Groq", "https://api.groq.com/openai/v1", config.GROQ_API_KEY, config.GROQ_MODEL);
    if (config.CUSTOM_LLM_BASE_URL) {
      this.addCompatible("custom", "Custom OpenAI-compatible", config.CUSTOM_LLM_BASE_URL, config.CUSTOM_LLM_API_KEY, config.CUSTOM_LLM_MODEL);
    }
    if (config.CLAUDE_CLI_ENABLED) {
      this.addProvider(new ClaudeCliProvider(
        resolveClaudeCliPath(config.CLAUDE_CLI_PATH),
        config.DATA_DIR,
        Math.min(config.LLM_TIMEOUT_MS, Math.max(1, config.STAGE_TIMEOUT_MS - 1)),
        config.CLAUDE_CLI_MODEL ?? null,
      ));
    }
    if (config.COPILOT_CLI_ENABLED) {
      const launch = resolveCopilotCliLaunch(config.COPILOT_CLI_PATH);
      this.addProvider(new CopilotCliProvider(
        launch?.binaryPath ?? null,
        config.DATA_DIR,
        timeoutMs,
        config.COPILOT_CLI_MODEL ?? null,
        undefined,
        launch ? { command: launch.command, argsPrefix: launch.argsPrefix } : undefined,
      ));
    }
    if (config.LLM_ENABLE_MOCK) this.addProvider(new MockLlmProvider());
  }

  get(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  isSupportedProvider(id: string): boolean {
    return LlmProviderIdSchema.safeParse(id).success;
  }

  async suggestModels(id: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
    const provider = this.providers.get(id);
    const staticModels: Record<string, string[]> = {
      anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
      gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
      openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
      ollama: [],
      openrouter: [],
      deepseek: ["deepseek-chat", "deepseek-reasoner"],
      groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
      custom: [],
      mock: ["mock"],
      "claude-cli": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
      "copilot-cli": ["gpt-6-luna"],
    };
    if (!LlmProviderIdSchema.safeParse(id).success) return [];
    const baseUrl = id === "openai" ? this.config.OPENAI_BASE_URL
      : id === "ollama" ? this.config.OLLAMA_BASE_URL
        : id === "openrouter" ? "https://openrouter.ai/api/v1"
          : id === "deepseek" ? "https://api.deepseek.com/v1"
            : id === "groq" ? "https://api.groq.com/openai/v1"
          : id === "custom" ? this.config.CUSTOM_LLM_BASE_URL
            : undefined;
    const cached = this.modelCache.get(id);
    let remoteModels: string[] = [];
    if (provider && baseUrl && (!cached || cached.expiresAt <= Date.now())) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const key = id === "openai" ? this.config.OPENAI_API_KEY
          : id === "openrouter" ? this.config.OPENROUTER_API_KEY
            : id === "custom" ? this.config.CUSTOM_LLM_API_KEY
              : undefined;
        const response = await fetchImpl(new URL("models", `${baseUrl.replace(/\/+$/, "")}/`), {
          signal: controller.signal,
          headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        });
        if (response.ok) {
          const payload = await response.json() as { data?: { id?: unknown }[] };
          remoteModels = (payload.data ?? []).flatMap((item) => typeof item.id === "string" ? [item.id] : []);
          this.modelCache.set(id, { expiresAt: Date.now() + 10 * 60_000, models: remoteModels });
        }
      } catch {
        remoteModels = cached?.models ?? [];
      } finally {
        clearTimeout(timeout);
      }
    } else {
      remoteModels = cached?.models ?? [];
    }
    return [...new Set([
      ...(provider?.defaultModel ? [provider.defaultModel] : []),
      ...(provider && this.config.LLM_DEFAULT_MODEL ? [this.config.LLM_DEFAULT_MODEL] : []),
      ...(staticModels[id] ?? []),
      ...remoteModels,
    ])];
  }

  list(monthCalls?: ReadonlyMap<string, number>): LlmProviderInfo[] {
    const labels: Record<LlmProviderId, string> = {
      anthropic: "Anthropic API",
      gemini: "Gemini API",
      openai: "OpenAI API",
      ollama: "Ollama",
      openrouter: "OpenRouter",
      deepseek: "DeepSeek",
      groq: "Groq",
      custom: "OpenAI-compatible tùy chỉnh",
      mock: "Mock (development)",
      "claude-cli": "Claude Code CLI",
      "copilot-cli": "GitHub Copilot CLI",
    };
    const hints: Record<LlmProviderId, string> = {
      anthropic: "Set ANTHROPIC_API_KEY to configure Anthropic API.",
      gemini: "Set GEMINI_API_KEY to configure Gemini API.",
      openai: "Set OPENAI_API_KEY to configure OpenAI API.",
      ollama: "Set OLLAMA_BASE_URL and OLLAMA_MODEL to configure Ollama.",
      openrouter: "Set OPENROUTER_API_KEY to configure OpenRouter.",
      deepseek: "Set DEEPSEEK_API_KEY to configure DeepSeek.",
      groq: "Set GROQ_API_KEY to configure Groq.",
      custom: "Set CUSTOM_LLM_BASE_URL to configure a compatible provider.",
      mock: "Set LLM_ENABLE_MOCK=true to enable the mock provider.",
      "claude-cli": "Enable CLAUDE_CLI_ENABLED and install/sign in to Claude Code CLI.",
      "copilot-cli": "Enable COPILOT_CLI_ENABLED and install/sign in to GitHub Copilot CLI.",
    };
    return LlmProviderIdSchema.options.map((id) => {
      const provider = this.providers.get(id);
      const isCliProvider = id === "claude-cli" || id === "copilot-cli";
      const configured = provider
        ? isCliProvider
          ? provider.configured === true
          : id !== "ollama" || Boolean(provider.defaultModel ?? this.config.LLM_DEFAULT_MODEL)
        : false;
      const hint = configured ? "Đã cấu hình." : provider?.hint ?? (id === "ollama" && provider ? "Set OLLAMA_MODEL" : hints[id]);
      return {
        id,
        label: provider?.label ?? labels[id],
        configured,
        defaultModel: provider?.defaultModel ?? null,
        hint,
        ...(provider?.limits ? { limits: provider.limits } : {}),
        ...(monthCalls ? { usage: { monthCalls: monthCalls.get(id) ?? 0 } } : {}),
      };
    });
  }

  resolve(
    projectStageSelection: LlmSelection | undefined,
    projectDefaultSelection: LlmSelection | undefined,
    stage: "research" | "script" | "sceneplan",
  ): { provider: LlmProvider; model: string } {
    const stageSelection = stage === "research"
      ? this.config.LLM_RESEARCH_PROVIDER
      : stage === "script" ? this.config.LLM_SCRIPT_PROVIDER : undefined;
    const stageModel = stage === "research"
      ? this.config.LLM_RESEARCH_MODEL
      : stage === "script" ? this.config.LLM_SCRIPT_MODEL : undefined;
    const providerId = projectStageSelection?.provider
      ?? projectDefaultSelection?.provider
      ?? stageSelection
      ?? this.config.LLM_DEFAULT_PROVIDER;
    const provider = providerId ? this.providers.get(providerId) : undefined;
    if (providerId === "claude-cli" && !this.config.CLAUDE_CLI_ENABLED) {
      throw createNotConfiguredError("Claude Code CLI is disabled. Set CLAUDE_CLI_ENABLED=true to enable it.");
    }
    if (providerId === "copilot-cli" && !this.config.COPILOT_CLI_ENABLED) {
      throw createNotConfiguredError("GitHub Copilot CLI is disabled. Set COPILOT_CLI_ENABLED=true to enable it.");
    }
    if (!provider) {
      throw createNotConfiguredError(providerId
        ? `LLM provider "${providerId}" is not configured. Set its API key or base URL in the server environment.`
        : "No LLM provider is selected. Choose an AI provider in project settings or set LLM_DEFAULT_PROVIDER.");
    }
    if (provider.id === "claude-cli" && !provider.configured) {
      throw createNotConfiguredError("Install Claude Code CLI and run `claude` once to log in.");
    }
    if (provider.id === "copilot-cli" && !provider.configured) {
      throw createNotConfiguredError(provider.hint ?? "Install GitHub Copilot CLI and sign in once");
    }
    const model = projectStageSelection?.model
      ?? projectDefaultSelection?.model
      ?? stageModel
      ?? this.config.LLM_DEFAULT_MODEL
      ?? provider.defaultModel;
    if (!model && provider.id !== "claude-cli" && provider.id !== "copilot-cli") {
      throw createNotConfiguredError(`No model is configured for ${provider.label}. Set the model in project settings or configure ${provider.id.toUpperCase()}_MODEL.`);
    }
    return { provider, model: model ?? "" };
  }

  resolveTask(
    task: LlmTaskId,
    project: Project,
    appRouting?: LlmSettings,
  ): ResolvedLlmRoute {
    const selection = resolveLlmRoute(task, project, appRouting, this.config);
    let provider: LlmProvider;
    let model: string;
    let failedRoute: { provider: string; model: string } | undefined;
    try {
      provider = this.requireConfiguredProvider(selection.route.provider);
      model = selection.route.model
        ?? (selection.source === "env-default" ? this.config.LLM_DEFAULT_MODEL : undefined)
        ?? provider.defaultModel
        ?? "";
    } catch (error) {
      if (!(error instanceof LlmError) || error.code !== "LLM_NOT_CONFIGURED" || !selection.route.fallback) throw error;
      failedRoute = {
        provider: selection.route.provider,
        model: selection.route.model ?? "",
      };
      const fallback = this.resolveFallback(selection.route.fallback);
      provider = fallback.provider;
      model = fallback.model;
    }
    if (!model && provider.id !== "claude-cli" && provider.id !== "copilot-cli") {
      throw createNotConfiguredError(`No model is configured for ${provider.label}. Set the model in project or app settings, or configure ${provider.id.toUpperCase()}_MODEL.`);
    }
    return {
      provider,
      model,
      maxOutputTokens: selection.route.maxOutputTokens,
      fallback: selection.route.fallback,
      source: selection.source,
      ...(failedRoute ? { failedRoute } : {}),
    };
  }

  resolveRoute(task: LlmTaskId, project: Project, appRouting?: LlmSettings): ResolvedRouteDescription {
    const selection = resolveLlmRoute(task, project, appRouting, this.config);
    const routeProvider = this.providers.get(selection.route.provider);
    return {
      provider: selection.route.provider,
      model: selection.route.model
        ?? (selection.source === "env-default" ? this.config.LLM_DEFAULT_MODEL : undefined)
        ?? routeProvider?.defaultModel
        ?? "",
      ...(selection.route.maxOutputTokens === undefined ? {} : { maxOutputTokens: selection.route.maxOutputTokens }),
      ...(selection.route.fallback ? { fallback: selection.route.fallback } : {}),
      source: selection.source,
    };
  }

  resolveFallback(route: { provider: string; model?: string }): { provider: LlmProvider; model: string } {
    const provider = this.requireConfiguredProvider(route.provider);
    const model = route.model ?? provider.defaultModel ?? "";
    if (!model && provider.id !== "claude-cli" && provider.id !== "copilot-cli") {
      throw createNotConfiguredError(`No model is configured for fallback provider ${provider.label}.`);
    }
    return { provider, model };
  }

  private addCompatible(
    id: string,
    label: string,
    baseUrl: string,
    apiKey: string | undefined,
    model: string | undefined,
    supportsJson = true,
  ): void {
    this.addProvider(new OpenAiCompatibleProvider(
      id,
      label,
      baseUrl,
      apiKey,
      model || null,
      Math.min(this.config.LLM_TIMEOUT_MS, Math.max(1, this.config.STAGE_TIMEOUT_MS - 1)),
      supportsJson,
    ));
  }

  private addProvider<T extends LlmProvider>(provider: T): void {
    this.providers.set(provider.id, Object.assign(provider, {
      limits: this.config.LLM_PROVIDER_LIMITS[provider.id as keyof typeof this.config.LLM_PROVIDER_LIMITS],
    }));
  }

  private requireConfiguredProvider(providerId: string): LlmProvider {
    const provider = this.providers.get(providerId);
    if (providerId === "claude-cli" && !this.config.CLAUDE_CLI_ENABLED) {
      throw createNotConfiguredError("Claude Code CLI is disabled. Set CLAUDE_CLI_ENABLED=true to enable it.");
    }
    if (providerId === "copilot-cli" && !this.config.COPILOT_CLI_ENABLED) {
      throw createNotConfiguredError("GitHub Copilot CLI is disabled. Set COPILOT_CLI_ENABLED=true to enable it.");
    }
    if (!provider) {
      throw createNotConfiguredError(`LLM provider "${providerId}" is not configured. Set its API key or base URL in the server environment.`);
    }
    if ((provider.id === "claude-cli" || provider.id === "copilot-cli") && !provider.configured) {
      throw createNotConfiguredError(provider.hint ?? `${provider.label} is not configured.`);
    }
    return provider;
  }
}

export type LlmRouteSource = "project-task" | "project-default" | "app-task" | "app-default" | "env-task" | "env-default";
export type ResolvedLlmRoute = {
  provider: LlmProvider;
  model: string;
  maxOutputTokens?: number;
  fallback?: { provider: string; model?: string };
  source: LlmRouteSource;
  failedRoute?: { provider: string; model: string };
};
export type ResolvedRouteDescription = {
  provider: string;
  model: string;
  maxOutputTokens?: number;
  fallback?: { provider: string; model?: string };
  source: LlmRouteSource;
};

export function resolveLlmRoute(
  task: LlmTaskId,
  project: Project,
  appRouting: LlmSettings | undefined,
  config: AppConfig,
): { route: LlmRoute; source: LlmRouteSource } {
  const candidates: Array<{ route: LlmRoute | undefined; source: LlmRouteSource }> = [
    { route: project.settings.llm?.tasks?.[task], source: "project-task" },
    { route: project.settings.llm?.default, source: "project-default" },
    { route: appRouting?.tasks?.[task], source: "app-task" },
    { route: appRouting?.default, source: "app-default" },
    { route: config.LLM_TASK_ROUTES[task], source: "env-task" },
    {
      route: config.LLM_DEFAULT_PROVIDER
        ? { provider: config.LLM_DEFAULT_PROVIDER, ...(config.LLM_DEFAULT_MODEL ? { model: config.LLM_DEFAULT_MODEL } : {}) }
        : undefined,
      source: "env-default",
    },
  ];
  const selected = candidates.find((candidate) => candidate.route !== undefined);
  if (!selected?.route) {
    throw createNotConfiguredError("No LLM provider is selected. Choose a provider in project or app settings, or set LLM_DEFAULT_PROVIDER.");
  }
  return selected as { route: LlmRoute; source: LlmRouteSource };
}

function createNotConfiguredError(message: string): LlmError {
  return new LlmError(message, "LLM_NOT_CONFIGURED", false);
}
