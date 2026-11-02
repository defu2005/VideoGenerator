import type { LlmProviderInfo, LlmSelection } from "@vg/shared";
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

  list(monthCalls?: ReadonlyMap<string, number>): LlmProviderInfo[] {
    return [...this.providers.values()].map((provider) => {
      const isCliProvider = provider.id === "claude-cli" || provider.id === "copilot-cli";
      const configured = isCliProvider
        ? provider.configured === true
        : provider.id !== "ollama" || Boolean(provider.defaultModel ?? this.config.LLM_DEFAULT_MODEL);
      return {
        id: provider.id as LlmProviderInfo["id"],
        label: provider.label,
        configured,
        defaultModel: provider.defaultModel,
        ...(isCliProvider && !configured && provider.hint ? { hint: provider.hint } : {}),
        ...(provider.id === "ollama" && !configured ? { hint: "Set OLLAMA_MODEL" } : {}),
        ...(provider.limits ? { limits: provider.limits } : {}),
        ...(monthCalls ? { usage: { monthCalls: monthCalls.get(provider.id) ?? 0 } } : {}),
      };
    });
  }

  resolve(
    projectStageSelection: LlmSelection | undefined,
    projectDefaultSelection: LlmSelection | undefined,
    stage: "research" | "script",
  ): { provider: LlmProvider; model: string } {
    const stageSelection = stage === "research"
      ? this.config.LLM_RESEARCH_PROVIDER
      : this.config.LLM_SCRIPT_PROVIDER;
    const stageModel = stage === "research" ? this.config.LLM_RESEARCH_MODEL : this.config.LLM_SCRIPT_MODEL;
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
}

function createNotConfiguredError(message: string): LlmError {
  return new LlmError(message, "LLM_NOT_CONFIGURED", false);
}
