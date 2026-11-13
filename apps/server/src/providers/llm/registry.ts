import { LlmProviderIdSchema, omnirouteModelSeesImages, visionImageBatchLimit, type LlmModelRef, type LlmProviderId, type LlmProviderInfo, type LlmRoute, type LlmSelection, type LlmSettings, type LlmTaskId, type Project } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCliProvider, resolveClaudeCliPath } from "./claudeCli.js";
import { AntgravityCliProvider, resolveAgyPath, AGY_STATIC_MODELS } from "./antigravityCli.js";
import { CopilotCliProvider } from "./copilotCli.js";
import { resolveCopilotCliLaunch } from "./cliProvider.js";
import { GeminiProvider } from "./gemini.js";
import { MockLlmProvider } from "./mock.js";
import { OllamaNativeProvider } from "./ollamaNative.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import { LlmError, type LlmProvider } from "./types.js";
import { fetchAnthropicModels, fetchGeminiModels, readCopilotAccountModels } from "./modelLists.js";
import { OmniRouteCatalogService, omniRouteBaseUrl, providerWithCapabilities } from "./omnirouteCatalog.js";
import { defaultLlmGatewaySettings } from "./gatewaySettings.js";
import type { LlmConnectionSettings, LlmGatewaySettings } from "@vg/shared";
import type { LlmQuotaController } from "./quota.js";
import { FailoverTracker } from "./failover.js";

// Active Claude models, newest first within each family. Deprecated ones are left out.
const CLAUDE_MODELS = [
  "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
  "claude-fable-5", "claude-opus-5", "claude-sonnet-5",
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
  "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5",
];

export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider & { configured?: boolean; hint?: string }>();
  private readonly modelCache = new Map<string, { expiresAt: number; models: string[] }>();
  readonly omnirouteCatalog: OmniRouteCatalogService;
  quota: LlmQuotaController | null = null;
  /** TASK-127: in-memory cooldowns and failover events. */
  readonly failover = new FailoverTracker();
  private loadGatewaySettings: () => LlmGatewaySettings = defaultLlmGatewaySettings;
  private loadVisionMarks: () => LlmModelRef[] = () => [];
  private loadConnections: () => LlmConnectionSettings | null = () => null;
  private resolveCustomKey: (slug: string) => string | undefined = () => undefined;
  private customEndpoints = new Map<string, { baseUrl: string; apiKey?: string }>();
  private disabled = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly options: { copilotHome?: string; fetchImpl?: typeof fetch } = {},
  ) {
    this.omnirouteCatalog = new OmniRouteCatalogService(config, options.fetchImpl ?? fetch);
    this.build();
  }

  /** Settings saved in Kết nối → AI: disabled providers, vision overrides and custom providers. */
  setConnectionLoader(loader: () => LlmConnectionSettings | null, customKey: (slug: string) => string | undefined): void {
    this.loadConnections = loader;
    this.resolveCustomKey = customKey;
  }

  /** Rebuilds every provider from the current config and saved settings. No restart needed. */
  reload(): void {
    this.modelCache.clear();
    this.build();
  }

  isDisabled(id: string): boolean {
    return this.disabled.has(id);
  }

  private build(): void {
    this.providers.clear();
    this.customEndpoints.clear();
    const config = this.config;
    let connections: LlmConnectionSettings | null = null;
    try { connections = this.loadConnections(); } catch { connections = null; }
    const envVisionFlag = (name: string, id?: string) => {
      const override = id ? connections?.providers[id]?.vision : undefined;
      if (override !== undefined) return override ? { vision: true, maxImagesPerCall: 10 } : { vision: false, maxImagesPerCall: 0 };
      return envVisionFlagFromEnv(name);
    };
    const timeoutMs = Math.min(config.LLM_TIMEOUT_MS, Math.max(1, config.STAGE_TIMEOUT_MS - 1));
    if (config.ANTHROPIC_API_KEY) {
      this.addProvider(new AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL || null, timeoutMs));
    }
    if (config.GEMINI_API_KEY) {
      this.addProvider(new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL || null, timeoutMs));
    }

    if (config.OPENAI_API_KEY) this.addCompatible("openai", "OpenAI", config.OPENAI_BASE_URL, config.OPENAI_API_KEY, config.OPENAI_MODEL, true, envVisionFlag("OPENAI_VISION", "openai"));
    if (config.OLLAMA_BASE_URL) this.addCompatible("ollama", "Ollama", config.OLLAMA_BASE_URL, undefined, config.OLLAMA_MODEL, false, envVisionFlag("OLLAMA_VISION", "ollama"));
    if (config.REMOTE_OLLAMA_BASE_URL && config.REMOTE_OLLAMA_TOKEN) {
      this.addProvider(new OllamaNativeProvider(
        "remote-ollama",
        "Ollama từ xa",
        config.REMOTE_OLLAMA_BASE_URL,
        config.REMOTE_OLLAMA_TOKEN,
        config.REMOTE_OLLAMA_MODEL || "llama3.2:1b",
        timeoutMs,
        ((connections?.providers["remote-ollama"]?.vision ?? (envVisionFlag("OLLAMA_VISION").vision || envVisionFlag("REMOTE_OLLAMA_VISION").vision))
          ? { vision: true, maxImagesPerCall: 10 } : { vision: false, maxImagesPerCall: 0 }),
      ));
    }
    if (config.OPENROUTER_API_KEY) this.addCompatible("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", config.OPENROUTER_API_KEY, config.OPENROUTER_MODEL, true, envVisionFlag("OPENROUTER_VISION", "openrouter"));
    if (config.DEEPSEEK_API_KEY) this.addCompatible("deepseek", "DeepSeek", "https://api.deepseek.com/v1", config.DEEPSEEK_API_KEY, config.DEEPSEEK_MODEL, true, envVisionFlag("DEEPSEEK_VISION", "deepseek"));
    if (config.GROQ_API_KEY) this.addCompatible("groq", "Groq", "https://api.groq.com/openai/v1", config.GROQ_API_KEY, config.GROQ_MODEL, true, envVisionFlag("GROQ_VISION", "groq"));
    // OmniRoute is a local gateway (default port 20128); setting its URL or key turns it on.
    if (config.OMNIROUTE_BASE_URL || config.OMNIROUTE_API_KEY) {
      this.addCompatible("omniroute", "OmniRoute", omniRouteBaseUrl(config), config.OMNIROUTE_API_KEY, config.OMNIROUTE_MODEL, true, envVisionFlag("OMNIROUTE_VISION", "omniroute"));
    }
    if (config.OPENCODE_API_KEY) this.addCompatible("opencode", "OpenCode Zen", config.OPENCODE_BASE_URL, config.OPENCODE_API_KEY, config.OPENCODE_MODEL, true, envVisionFlag("OPENCODE_VISION", "opencode"));
    if (config.CUSTOM_LLM_BASE_URL) {
      this.addCompatible("custom", "Custom OpenAI-compatible", config.CUSTOM_LLM_BASE_URL, config.CUSTOM_LLM_API_KEY, config.CUSTOM_LLM_MODEL, true, envVisionFlag("CUSTOM_LLM_VISION", "custom"));
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
    if (config.ANTIGRAVITY_CLI_ENABLED) {
      this.addProvider(new AntgravityCliProvider(
        resolveAgyPath(config.ANTIGRAVITY_CLI_PATH ?? ""),
        config.DATA_DIR,
        Math.min(config.LLM_TIMEOUT_MS, Math.max(1, config.STAGE_TIMEOUT_MS - 1)),
        config.ANTIGRAVITY_CLI_MODEL ?? null,
        config.ANTIGRAVITY_CLI_EFFORT,
      ));
    }
    if (config.LLM_ENABLE_MOCK) this.addProvider(new MockLlmProvider());
    for (const custom of connections?.custom ?? []) {
      if (!custom.enabled) continue;
      const id = `custom-${custom.slug}`;
      const apiKey = this.resolveCustomKey(custom.slug);
      this.customEndpoints.set(id, { baseUrl: custom.baseUrl, ...(apiKey ? { apiKey } : {}) });
      this.addCompatible(id, custom.label, custom.baseUrl, apiKey, custom.defaultModel, true,
        { embeddings: custom.embeddings ?? false, vision: custom.vision ?? false, maxImagesPerCall: custom.vision ? 10 : 0 });
    }
    this.disabled = new Set(Object.entries(connections?.providers ?? {}).filter(([, value]) => value.enabled === false).map(([id]) => id));
    for (const id of this.disabled) this.providers.delete(id);
  }

  /** Custom providers saved in the app, as `custom-<slug>`. */
  customProviders(): Array<{ id: string; label: string; enabled: boolean }> {
    let connections: LlmConnectionSettings | null = null;
    try { connections = this.loadConnections(); } catch { connections = null; }
    return (connections?.custom ?? []).map((custom) => ({ id: `custom-${custom.slug}`, label: custom.label, enabled: custom.enabled }));
  }

  get(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  setGatewaySettingsLoader(loader: () => LlmGatewaySettings): void {
    this.loadGatewaySettings = loader;
  }

  getGatewaySettings(): LlmGatewaySettings {
    return this.loadGatewaySettings();
  }

  setVisionMarkLoader(loader: () => LlmModelRef[]): void {
    this.loadVisionMarks = loader;
  }

  visionMarks(): LlmModelRef[] {
    return this.loadVisionMarks();
  }

  /** A saved mark lets one model accept images when its provider is not a vision provider. */
  applyVisionMark(provider: LlmProvider, model: string): LlmProvider {
    if (provider.capabilities?.vision) return provider;
    if (provider.id === "omniroute" && omnirouteModelSeesImages(model)) {
      return providerWithCapabilities(provider, {
        vision: true,
        maxImagesPerCall: visionImageBatchLimit(provider.capabilities?.maxImagesPerCall),
      });
    }
    const marked = this.visionMarks().some((row) => row.provider === provider.id && row.model === model);
    if (!marked) return provider;
    return providerWithCapabilities(provider, {
      vision: true,
      maxImagesPerCall: visionImageBatchLimit(provider.capabilities?.maxImagesPerCall),
    });
  }

  isSupportedProvider(id: string): boolean {
    if (LlmProviderIdSchema.safeParse(id).success) return true;
    return this.customProviders().some((custom) => custom.id === id);
  }

  async suggestModels(id: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
    if (!this.isSupportedProvider(id)) return [];
    const provider = this.providers.get(id);
    // Shown when the live list is unavailable (provider not configured, offline, CLI without a list command).
    const staticModels: Record<string, string[]> = {
      anthropic: CLAUDE_MODELS,
      gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
      openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
      ollama: [],
      "remote-ollama": ["llama3.2:1b"],
      openrouter: [],
      deepseek: ["deepseek-chat", "deepseek-reasoner"],
      groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
      // OmniRoute names models "provider/model" or a combo you build in its dashboard.
      omniroute: [],
      opencode: [],
      custom: [],
      mock: ["mock"],
      // Claude Code has no list command; it takes the same model ids plus short aliases.
      "claude-cli": [...CLAUDE_MODELS, "fable", "opus", "sonnet", "haiku"],
      "copilot-cli": ["auto"],
      "antigravity-cli": AGY_STATIC_MODELS,
    };
    const liveModels = provider ? await this.liveModels(id, fetchImpl) : [];
    return [...new Set([
      ...(provider?.defaultModel ? [provider.defaultModel] : []),
      ...(provider && this.config.LLM_DEFAULT_MODEL ? [this.config.LLM_DEFAULT_MODEL] : []),
      ...liveModels,
      ...(staticModels[id] ?? []),
    ])];
  }

  /** Asks the provider itself which models it offers. Cached for 10 minutes; [] when it cannot say. */
  private async liveModels(id: string, fetchImpl: typeof fetch): Promise<string[]> {
    const cached = this.modelCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    let models: string[] = [];
    try {
      models = await this.fetchLiveModels(id, fetchImpl);
    } catch {
      models = [];
    }
    if (models.length === 0) return cached?.models ?? [];
    this.modelCache.set(id, { expiresAt: Date.now() + 10 * 60_000, models });
    return models;
  }

  private async fetchLiveModels(id: string, fetchImpl: typeof fetch): Promise<string[]> {
    if (id === "anthropic" && this.config.ANTHROPIC_API_KEY) {
      return fetchAnthropicModels(this.config.ANTHROPIC_API_KEY, fetchImpl);
    }
    if (id === "claude-cli" && this.config.ANTHROPIC_API_KEY) {
      return fetchAnthropicModels(this.config.ANTHROPIC_API_KEY, fetchImpl);
    }
    if (id === "gemini" && this.config.GEMINI_API_KEY) {
      return fetchGeminiModels(this.config.GEMINI_API_KEY, fetchImpl);
    }
    if (id === "copilot-cli") {
      const models = await readCopilotAccountModels(this.options.copilotHome);
      return models.length > 0 ? ["auto", ...models] : [];
    }
    if (id === "antigravity-cli") {
      const provider = this.providers.get(id);
      return provider instanceof AntgravityCliProvider ? provider.listModels() : [];
    }
    if (id === "remote-ollama" && this.config.REMOTE_OLLAMA_BASE_URL && this.config.REMOTE_OLLAMA_TOKEN) {
      const response = await fetchImpl(new URL("/api/tags", `${this.config.REMOTE_OLLAMA_BASE_URL.replace(/\/+$/, "")}/`), {
        headers: { Authorization: `Bearer ${this.config.REMOTE_OLLAMA_TOKEN}` },
      });
      if (!response.ok) return [];
      const payload = await response.json() as { models?: { name?: unknown }[] };
      return (payload.models ?? []).flatMap((item) => typeof item.name === "string" ? [item.name] : []);
    }
    if (id === "omniroute" && this.providers.has("omniroute")) {
      try {
        const models = await this.omnirouteCatalog.getModels({ fetchImpl });
        return models.map((model) => model.id);
      } catch {
        return this.omnirouteCatalog.peekModels().map((model) => model.id);
      }
    }
    const customEndpoint = this.customEndpoints.get(id);
    const baseUrl = customEndpoint ? customEndpoint.baseUrl
      : id === "openai" ? this.config.OPENAI_BASE_URL
      : id === "ollama" ? this.config.OLLAMA_BASE_URL
        : id === "openrouter" ? "https://openrouter.ai/api/v1"
          : id === "deepseek" ? "https://api.deepseek.com/v1"
            : id === "groq" ? "https://api.groq.com/openai/v1"
              : id === "opencode" ? this.config.OPENCODE_BASE_URL
              : id === "custom" ? this.config.CUSTOM_LLM_BASE_URL
                : undefined;
    if (!baseUrl) return [];
    const key = customEndpoint ? customEndpoint.apiKey
      : id === "openai" ? this.config.OPENAI_API_KEY
      : id === "openrouter" ? this.config.OPENROUTER_API_KEY
        : id === "deepseek" ? this.config.DEEPSEEK_API_KEY
          : id === "groq" ? this.config.GROQ_API_KEY
          : id === "opencode" ? this.config.OPENCODE_API_KEY
            : id === "custom" ? this.config.CUSTOM_LLM_API_KEY
              : undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchImpl(new URL("models", `${baseUrl.replace(/\/+$/, "")}/`), {
        signal: controller.signal,
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      });
      if (!response.ok) return [];
      const payload = await response.json() as { data?: { id?: unknown }[] };
      return (payload.data ?? []).flatMap((item) => typeof item.id === "string" ? [item.id] : []);
    } finally {
      clearTimeout(timeout);
    }
  }

  list(monthCalls?: ReadonlyMap<string, number>): LlmProviderInfo[] {
    const labels: Record<LlmProviderId, string> = {
      anthropic: "Anthropic API",
      gemini: "Gemini API",
      openai: "OpenAI API",
      ollama: "Ollama",
      "remote-ollama": "Ollama từ xa",
      openrouter: "OpenRouter",
      deepseek: "DeepSeek",
      groq: "Groq",
      omniroute: "OmniRoute (gateway cục bộ)",
      opencode: "OpenCode Zen",
      custom: "OpenAI-compatible tùy chỉnh",
      mock: "Mock (development)",
      "claude-cli": "Claude Code CLI",
      "copilot-cli": "GitHub Copilot CLI",
      "antigravity-cli": "Antigravity CLI (tài khoản Google)",
    };
    const inApp = "Nhập key trong Kết nối → AI.";
    const hints: Record<LlmProviderId, string> = {
      anthropic: inApp,
      gemini: inApp,
      openai: inApp,
      ollama: "Chạy Ollama rồi nhập địa chỉ và model trong Kết nối → AI.",
      "remote-ollama": "Nhập địa chỉ tunnel HTTPS và token trong Kết nối → AI.",
      openrouter: "Đăng nhập OpenRouter hoặc nhập key trong Kết nối → AI.",
      deepseek: inApp,
      groq: inApp,
      omniroute: "Chạy OmniRoute (mặc định http://127.0.0.1:20128/v1), tạo endpoint key trong dashboard rồi nhập trong Kết nối → AI.",
      opencode: "Tạo API key trong OpenCode Zen console rồi nhập trong Kết nối → AI.",
      custom: "Nhập địa chỉ API trong Kết nối → AI.",
      mock: "Chỉ dùng khi phát triển (LLM_ENABLE_MOCK=true).",
      "claude-cli": "Bật Claude Code CLI trong Kết nối → AI, rồi cài và đăng nhập CLI.",
      "copilot-cli": "Bật GitHub Copilot CLI trong Kết nối → AI, rồi cài và đăng nhập CLI.",
      "antigravity-cli": "Cài agy và chạy agy một lần để đăng nhập Google",
    };
    const builtIn: LlmProviderInfo[] = LlmProviderIdSchema.options.map((id) => {
      const provider = this.providers.get(id);
      const isCliProvider = id === "claude-cli" || id === "copilot-cli" || id === "antigravity-cli";
      const configured = provider
        ? isCliProvider
          ? provider.configured === true
          : id !== "ollama" || Boolean(provider.defaultModel ?? this.config.LLM_DEFAULT_MODEL)
        : false;
      const hint = this.disabled.has(id) ? "Đã tắt trong Kết nối → AI."
        : configured ? "Đã cấu hình." : provider?.hint ?? (id === "ollama" && provider ? "Nhập model cho Ollama trong Kết nối → AI." : hints[id]);
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
    const custom: LlmProviderInfo[] = this.customProviders().map((entry) => {
      const provider = this.providers.get(entry.id);
      return {
        id: entry.id,
        label: entry.label,
        configured: Boolean(provider),
        defaultModel: provider?.defaultModel ?? null,
        hint: provider ? "Đã cấu hình." : "Đã tắt trong Kết nối → AI.",
        ...(monthCalls ? { usage: { monthCalls: monthCalls.get(entry.id) ?? 0 } } : {}),
      };
    });
    return [...builtIn, ...custom];
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
      throw createNotConfiguredError("Claude Code CLI đang tắt. Bật trong Kết nối → AI.");
    }
    if (providerId === "copilot-cli" && !this.config.COPILOT_CLI_ENABLED) {
      throw createNotConfiguredError("GitHub Copilot CLI đang tắt. Bật trong Kết nối → AI.");
    }
    if (providerId === "antigravity-cli" && !this.config.ANTIGRAVITY_CLI_ENABLED) {
      throw createNotConfiguredError("Antigravity CLI đang tắt. Bật trong Kết nối → AI.");
    }
    if (!provider) {
      throw createNotConfiguredError(providerId
        ? (this.disabled.has(providerId) ? `Nhà cung cấp AI "${providerId}" đang tắt. Bật lại trong Kết nối → AI.` : `Nhà cung cấp AI "${providerId}" chưa được cấu hình. Nhập key trong Kết nối → AI.`)
        : "No LLM provider is selected. Choose an AI provider in project settings or set LLM_DEFAULT_PROVIDER.");
    }
    if (provider.id === "claude-cli" && !provider.configured) {
      throw createNotConfiguredError("Install Claude Code CLI and run `claude` once to log in.");
    }
    if (provider.id === "copilot-cli" && !provider.configured) {
      throw createNotConfiguredError(provider.hint ?? "Install GitHub Copilot CLI and sign in once");
    }
    if (provider.id === "antigravity-cli" && !provider.configured) {
      throw createNotConfiguredError(provider.hint ?? "Cài agy và chạy `agy` một lần để đăng nhập Google");
    }
    const model = projectStageSelection?.model
      ?? projectDefaultSelection?.model
      ?? stageModel
      ?? this.config.LLM_DEFAULT_MODEL
      ?? provider.defaultModel;
    if (!model && provider.id !== "claude-cli" && provider.id !== "copilot-cli" && provider.id !== "antigravity-cli") {
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
    if (!model && provider.id !== "claude-cli" && provider.id !== "copilot-cli" && provider.id !== "antigravity-cli") {
      throw createNotConfiguredError(`No model is configured for ${provider.label}. Set the model in project or app settings, or configure ${provider.id.toUpperCase()}_MODEL.`);
    }
    if (task === "retrievalEmbed" && !provider.capabilities?.embeddings) throw createNotConfiguredError("Provider does not support embeddings");
    provider = this.applyVisionMark(provider, model);
    return {
      provider,
      model,
      maxOutputTokens: selection.route.maxOutputTokens,
      fallback: selection.route.fallback,
      fallbacks: selection.route.fallbacks,
      source: selection.source,
      budgetMode: project.settings.budget?.mode,
      autonomy: project.mode,
      profileId: project.profileId ?? null,
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
      ...(selection.route.fallbacks?.length ? { fallbacks: selection.route.fallbacks } : {}),
      source: selection.source,
    };
  }

  resolveFallback(route: { provider: string; model?: string }): { provider: LlmProvider; model: string } {
    const provider = this.requireConfiguredProvider(route.provider);
    const model = route.model ?? provider.defaultModel ?? "";
    if (!model && provider.id !== "claude-cli" && provider.id !== "copilot-cli" && provider.id !== "antigravity-cli") {
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
    visionCapabilities: { vision: boolean; maxImagesPerCall: number; embeddings?: boolean } = { vision: false, maxImagesPerCall: 0 },
  ): void {
    this.addProvider(new OpenAiCompatibleProvider(
      id,
      label,
      baseUrl,
      apiKey,
      model || null,
      Math.min(this.config.LLM_TIMEOUT_MS, Math.max(1, this.config.STAGE_TIMEOUT_MS - 1)),
      supportsJson,
      { ...visionCapabilities, ...(id === "custom" ? { embeddings: this.loadConnections()?.providers.custom?.embeddings ?? false } : {}) },
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
      throw createNotConfiguredError("Claude Code CLI đang tắt. Bật trong Kết nối → AI.");
    }
    if (providerId === "copilot-cli" && !this.config.COPILOT_CLI_ENABLED) {
      throw createNotConfiguredError("GitHub Copilot CLI đang tắt. Bật trong Kết nối → AI.");
    }
    if (providerId === "antigravity-cli" && !this.config.ANTIGRAVITY_CLI_ENABLED) {
      throw createNotConfiguredError("Antigravity CLI đang tắt. Bật trong Kết nối → AI.");
    }
    if (!provider) {
      throw createNotConfiguredError((this.disabled.has(providerId) ? `Nhà cung cấp AI "${providerId}" đang tắt. Bật lại trong Kết nối → AI.` : `Nhà cung cấp AI "${providerId}" chưa được cấu hình. Nhập key trong Kết nối → AI.`));
    }
    if ((provider.id === "claude-cli" || provider.id === "copilot-cli" || provider.id === "antigravity-cli") && !provider.configured) {
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
  fallbacks?: { provider: string; model?: string }[];
  source: LlmRouteSource;
  failedRoute?: { provider: string; model: string };
  budgetMode?: string;
  autonomy?: "AUTO" | "ASSISTED" | "MANUAL";
  profileId?: string | null;
};
export type ResolvedRouteDescription = {
  provider: string;
  model: string;
  maxOutputTokens?: number;
  fallback?: { provider: string; model?: string };
  fallbacks?: { provider: string; model?: string }[];
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

export { omniRouteBaseUrl } from "./omnirouteCatalog.js";

function createNotConfiguredError(message: string): LlmError {
  return new LlmError(message, "LLM_NOT_CONFIGURED", false);
}

function envVisionFlagFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): { vision: boolean; maxImagesPerCall: number } {
  const raw = env[name]?.trim().toLowerCase();
  const enabled = raw === "1" || raw === "true" || raw === "yes";
  return enabled ? { vision: true, maxImagesPerCall: 10 } : { vision: false, maxImagesPerCall: 0 };
}
