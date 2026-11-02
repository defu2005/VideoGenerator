import type { LlmProviderInfo, LlmSelection } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { MockLlmProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import { LlmError, type LlmProvider } from "./types.js";

export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(private readonly config: AppConfig) {
    const timeoutMs = Math.min(config.LLM_TIMEOUT_MS, Math.max(1, config.STAGE_TIMEOUT_MS - 1));
    if (config.ANTHROPIC_API_KEY) {
      this.providers.set("anthropic", new AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL || null, timeoutMs));
    }
    if (config.GEMINI_API_KEY) {
      this.providers.set("gemini", new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL || null, timeoutMs));
    }

    if (config.OPENAI_API_KEY) this.addCompatible("openai", "OpenAI", config.OPENAI_BASE_URL, config.OPENAI_API_KEY, config.OPENAI_MODEL);
    if (config.OLLAMA_BASE_URL) this.addCompatible("ollama", "Ollama", config.OLLAMA_BASE_URL, undefined, config.OLLAMA_MODEL, false);
    if (config.OPENROUTER_API_KEY) this.addCompatible("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", config.OPENROUTER_API_KEY, config.OPENROUTER_MODEL);
    if (config.DEEPSEEK_API_KEY) this.addCompatible("deepseek", "DeepSeek", "https://api.deepseek.com/v1", config.DEEPSEEK_API_KEY, config.DEEPSEEK_MODEL);
    if (config.GROQ_API_KEY) this.addCompatible("groq", "Groq", "https://api.groq.com/openai/v1", config.GROQ_API_KEY, config.GROQ_MODEL);
    if (config.CUSTOM_LLM_BASE_URL) {
      this.addCompatible("custom", "Custom OpenAI-compatible", config.CUSTOM_LLM_BASE_URL, config.CUSTOM_LLM_API_KEY, config.CUSTOM_LLM_MODEL);
    }
    if (config.LLM_ENABLE_MOCK) this.providers.set("mock", new MockLlmProvider());
  }

  get(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  list(): LlmProviderInfo[] {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id as LlmProviderInfo["id"],
      label: provider.label,
      configured: provider.id !== "ollama" || Boolean(provider.defaultModel ?? this.config.LLM_DEFAULT_MODEL),
      defaultModel: provider.defaultModel,
      ...(provider.id === "ollama" && !provider.defaultModel && !this.config.LLM_DEFAULT_MODEL
        ? { hint: "Set OLLAMA_MODEL" }
        : {}),
    }));
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
    if (!provider) {
      throw createNotConfiguredError(providerId
        ? `LLM provider "${providerId}" is not configured. Set its API key or base URL in the server environment.`
        : "No LLM provider is selected. Choose an AI provider in project settings or set LLM_DEFAULT_PROVIDER.");
    }
    const model = projectStageSelection?.model
      ?? projectDefaultSelection?.model
      ?? stageModel
      ?? this.config.LLM_DEFAULT_MODEL
      ?? provider.defaultModel;
    if (!model) {
      throw createNotConfiguredError(`No model is configured for ${provider.label}. Set the model in project settings or configure ${provider.id.toUpperCase()}_MODEL.`);
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
    this.providers.set(id, new OpenAiCompatibleProvider(
      id,
      label,
      baseUrl,
      apiKey,
      model || null,
      Math.min(this.config.LLM_TIMEOUT_MS, Math.max(1, this.config.STAGE_TIMEOUT_MS - 1)),
      supportsJson,
    ));
  }
}

function createNotConfiguredError(message: string): LlmError {
  return new LlmError(message, "LLM_NOT_CONFIGURED", false);
}
