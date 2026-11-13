import {
  OMNIROUTE_SETUP_HINT,
  OmniRouteModelInfoSchema,
  omnirouteModelSeesImages,
  type LlmGatewayMapping,
  type LlmGatewaySettings,
  type OmniRouteCatalog,
  type OmniRouteHealth,
  type OmniRouteModelInfo,
  type OmniRouteModelPricing,
} from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import type { LlmProvider, LlmProviderCapabilities } from "./types.js";
import { LlmError } from "./types.js";

export function omniRouteBaseUrl(config: Pick<AppConfig, "OMNIROUTE_BASE_URL">): string {
  return config.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128/v1";
}

const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_SYNC_MS = 15 * 60_000;
const CATALOG_BACKOFF_MS = 60 * 60_000;
const HEALTH_TIMEOUT_MS = 3_000;
const CLI_PROVIDERS = new Set(["claude-cli", "copilot-cli", "antigravity-cli"]);

type CatalogCache = {
  expiresAt: number;
  cachedAt: string;
  models: OmniRouteModelInfo[];
};

/** Module-level pricing mirror so estimateLlmCost can read catalog prices without a circular import. */
const pricingByModel = new Map<string, OmniRouteModelPricing>();

export function getCachedOmniroutePricing(modelId: string): OmniRouteModelPricing | undefined {
  return pricingByModel.get(modelId);
}

export function parseOmnirouteModelsPayload(payload: unknown): OmniRouteModelInfo[] {
  const root = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : [];
  const models: OmniRouteModelInfo[] = [];
  for (const row of rows) {
    const parsed = mapOmnirouteModelRow(row);
    if (parsed) models.push(parsed);
  }
  return models;
}

export function mapOmnirouteModelRow(row: unknown): OmniRouteModelInfo | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const item = row as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) return undefined;

  const ownedBy = typeof item.owned_by === "string" ? item.owned_by
    : typeof item.ownedBy === "string" ? item.ownedBy
      : "omniroute";

  const contextWindow = firstPositiveNumber(
    item.context_window,
    item.contextWindow,
    item.context_length,
    item.contextLength,
    item.max_model_len,
    item.max_tokens,
  );

  const vision = inferVision(item);

  const pricing = mapPricing(item.pricing ?? item.price);

  const candidate = {
    id: item.id,
    ownedBy,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(vision !== undefined ? { vision } : {}),
    ...(pricing ? { pricing } : {}),
  };
  const parsed = OmniRouteModelInfoSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function resolveOmnirouteModelId(
  provider: string,
  model: string,
  catalogIds: ReadonlySet<string>,
  mappings: readonly LlmGatewayMapping[],
): string | undefined {
  const mapped = mappings.find((entry) => entry.provider === provider && entry.model === model);
  if (mapped) return mapped.omnirouteModel;
  if (CLI_PROVIDERS.has(provider)) return undefined;
  if (model && catalogIds.has(model)) return model;
  return undefined;
}

export function shouldGatewayFallback(error: LlmError): boolean {
  if (error.code === "LLM_TIMEOUT" || error.code === "LLM_UNAVAILABLE") {
    if (error.status !== undefined && error.status < 500) return false;
    return true;
  }
  return false;
}

export class OmniRouteCatalogService {
  private cache: CatalogCache | undefined;
  private lastError: string | null = null;
  private failures = 0;
  private backoffUntil = 0;
  private refreshFlight: Promise<void> | null = null;
  lastDiff: { added: string[]; removed: string[]; capabilityChanges: string[] } | null = null;
  onDiff?: (diff: { added: string[]; removed: string[]; capabilityChanges: string[] }) => void;

  constructor(
    private readonly config: Pick<AppConfig, "OMNIROUTE_BASE_URL" | "OMNIROUTE_API_KEY">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get baseUrl(): string {
    return omniRouteBaseUrl(this.config);
  }

  get configured(): boolean {
    return Boolean(this.config.OMNIROUTE_BASE_URL || this.config.OMNIROUTE_API_KEY);
  }

  peekModels(): OmniRouteModelInfo[] {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.models;
    return this.cache?.models ?? [];
  }

  getCatalogSnapshot(): OmniRouteCatalog {
    const models = this.peekModels();
    return {
      models,
      cachedAt: this.cache?.cachedAt ?? null,
      baseUrl: this.baseUrl,
    };
  }

  invalidate(): void {
    this.cache = undefined;
  }

  async getModels(options: { forceRefresh?: boolean; fetchImpl?: typeof fetch } = {}): Promise<OmniRouteModelInfo[]> {
    const fresh = Boolean(this.cache && this.cache.expiresAt > Date.now());
    if (!options.forceRefresh && fresh) return this.cache!.models;
    if (!options.forceRefresh && this.cache && Date.now() < this.backoffUntil) return this.cache.models;
    if (!options.forceRefresh && this.cache?.models.length) {
      this.kickRefresh(options.fetchImpl);
      return this.cache.models;
    }
    return this.loadModels(options.fetchImpl);
  }

  /** Wait for a stale-while-revalidate refresh started by getModels. */
  settleRefresh(): Promise<void> {
    return this.refreshFlight ?? Promise.resolve();
  }

  private kickRefresh(fetchImpl?: typeof fetch): void {
    if (this.refreshFlight) return;
    this.refreshFlight = this.loadModels(fetchImpl).then(() => undefined).catch(() => undefined).finally(() => {
      this.refreshFlight = null;
    });
  }

  private async loadModels(fetchImpl?: typeof fetch): Promise<OmniRouteModelInfo[]> {
    try {
      const models = await this.fetchModels(fetchImpl);
      this.rememberModels(models);
      this.lastError = null;
      this.failures = 0;
      this.backoffUntil = 0;
      return models;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= 3) this.backoffUntil = Date.now() + CATALOG_BACKOFF_MS;
      this.lastError = error instanceof Error ? error.message : String(error);
      if (this.cache?.models.length) return this.cache.models;
      throw error;
    }
  }

  /** Refresh 30s after startup, then every 15 minutes. Skips a missing OmniRoute config. */
  startBackgroundSync(): () => void {
    if (!this.configured || process.env.VITEST) return () => undefined;
    const run = () => {
      void this.getModels({ forceRefresh: Date.now() >= this.backoffUntil }).catch(() => undefined);
    };
    const first = setTimeout(run, 30_000);
    const timer = setInterval(run, CATALOG_SYNC_MS);
    first.unref?.();
    timer.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }

  async health(fetchImpl: typeof fetch = this.fetchImpl): Promise<OmniRouteHealth> {
    const started = Date.now();
    if (!this.configured) {
      return {
        reachable: false,
        latencyMs: null,
        modelCount: 0,
        lastError: null,
        baseUrl: this.baseUrl,
        configured: false,
        setupHint: OMNIROUTE_SETUP_HINT,
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(new URL("models", `${this.baseUrl.replace(/\/+$/, "")}/`), {
        signal: controller.signal,
        headers: this.authHeaders(),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        this.lastError = `HTTP ${response.status}`;
        return {
          reachable: false,
          latencyMs,
          modelCount: this.peekModels().length,
          lastError: this.lastError,
          baseUrl: this.baseUrl,
          configured: true,
          setupHint: OMNIROUTE_SETUP_HINT,
        };
      }
      const models = parseOmnirouteModelsPayload(await response.json());
      this.rememberModels(models);
      this.lastError = null;
      return {
        reachable: true,
        latencyMs,
        modelCount: models.length,
        lastError: null,
        baseUrl: this.baseUrl,
        configured: true,
        setupHint: OMNIROUTE_SETUP_HINT,
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        reachable: false,
        latencyMs: Date.now() - started,
        modelCount: this.peekModels().length,
        lastError: this.lastError,
        baseUrl: this.baseUrl,
        configured: true,
        setupHint: OMNIROUTE_SETUP_HINT,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveGatewayTarget(
    providerId: string,
    model: string,
    settings: LlmGatewaySettings,
  ): Promise<{ omnirouteModel: string; catalogModel?: OmniRouteModelInfo } | undefined> {
    if (settings.mode === "off") return undefined;
    let models: OmniRouteModelInfo[];
    try {
      models = await this.getModels();
    } catch {
      models = this.peekModels();
    }
    const catalogIds = new Set(models.map((item) => item.id));
    const omnirouteModel = resolveOmnirouteModelId(providerId, model, catalogIds, settings.mappings);
    if (!omnirouteModel) return undefined;
    return {
      omnirouteModel,
      catalogModel: models.find((item) => item.id === omnirouteModel),
    };
  }

  private rememberModels(models: OmniRouteModelInfo[]): void {
    const previousModels = this.cache?.models ?? [];
    const previous = new Set(previousModels.map((item) => item.id));
    const next = new Set(models.map((item) => item.id));
    if (previous.size > 0) {
      const added = [...next].filter((id) => !previous.has(id));
      const removed = [...previous].filter((id) => !next.has(id));
      const priorVision = new Map(previousModels.map((item) => [item.id, item.vision]));
      const capabilityChanges = models
        .filter((item) => priorVision.has(item.id) && priorVision.get(item.id) !== item.vision)
        .map((item) => item.id);
      this.lastDiff = { added, removed, capabilityChanges };
      if (added.length || removed.length || capabilityChanges.length) {
        this.onDiff?.({ added, removed, capabilityChanges });
      }
    }
    this.cache = {
      models,
      cachedAt: new Date().toISOString(),
      expiresAt: Date.now() + CATALOG_TTL_MS,
    };
    pricingByModel.clear();
    for (const model of models) {
      if (model.pricing) pricingByModel.set(model.id, model.pricing);
    }
  }

  private async fetchModels(fetchImpl: typeof fetch = this.fetchImpl): Promise<OmniRouteModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(new URL("models", `${this.baseUrl.replace(/\/+$/, "")}/`), {
        signal: controller.signal,
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`OmniRoute models HTTP ${response.status}`);
      }
      return parseOmnirouteModelsPayload(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeaders(): HeadersInit | undefined {
    return this.config.OMNIROUTE_API_KEY
      ? { Authorization: `Bearer ${this.config.OMNIROUTE_API_KEY}` }
      : undefined;
  }
}

export function providerWithCapabilities(
  provider: LlmProvider,
  capabilities: LlmProviderCapabilities,
): LlmProvider {
  return {
    id: provider.id,
    label: provider.label,
    defaultModel: provider.defaultModel,
    limits: provider.limits,
    configured: provider.configured,
    hint: provider.hint,
    capabilities,
    generate: (req, signal) => provider.generate(req, signal),
  };
}

export function envOmnirouteVision(env: NodeJS.ProcessEnv = process.env): LlmProviderCapabilities {
  const raw = env.OMNIROUTE_VISION?.trim().toLowerCase();
  const enabled = raw === "1" || raw === "true" || raw === "yes";
  return enabled ? { vision: true, maxImagesPerCall: 10 } : { vision: false, maxImagesPerCall: 0 };
}

function inferVision(item: Record<string, unknown>): boolean | undefined {
  if (typeof item.vision === "boolean") return item.vision;
  if (typeof item.supports_vision === "boolean") return item.supports_vision;
  if (typeof item.supportsVision === "boolean") return item.supportsVision;
  const architecture = typeof item.architecture === "object" && item.architecture !== null
    ? item.architecture as Record<string, unknown>
    : undefined;
  const modality = typeof architecture?.modality === "string" ? architecture.modality.toLowerCase()
    : typeof item.modality === "string" ? item.modality.toLowerCase()
      : undefined;
  if (modality) return modality.includes("image") || modality.includes("vision");
  if (typeof item.id === "string" && omnirouteModelSeesImages(item.id)) return true;
  return undefined;
}

function mapPricing(value: unknown): OmniRouteModelPricing | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const pricing = value as Record<string, unknown>;
  const inputPerMTok = firstNonNegativeNumber(
    pricing.inputPerMTok,
    pricing.input_per_mtok,
    pricing.prompt_per_mtok,
    perMillionFromUnit(pricing.prompt),
    perMillionFromUnit(pricing.input),
    perMillionFromUnit(pricing.input_cost_per_token),
  );
  const outputPerMTok = firstNonNegativeNumber(
    pricing.outputPerMTok,
    pricing.output_per_mtok,
    pricing.completion_per_mtok,
    perMillionFromUnit(pricing.completion),
    perMillionFromUnit(pricing.output),
    perMillionFromUnit(pricing.output_cost_per_token),
  );
  if (inputPerMTok === undefined || outputPerMTok === undefined) return undefined;
  return { inputPerMTok, outputPerMTok };
}

function perMillionFromUnit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  // OpenRouter-style prices are USD per token; convert to per million tokens when tiny.
  return value > 0 && value < 0.01 ? value * 1_000_000 : value;
}

function firstPositiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

function firstNonNegativeNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}
