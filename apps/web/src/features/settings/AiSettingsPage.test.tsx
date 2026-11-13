import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LLM_TASKS } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AiSettingsPage } from "./AiSettingsPage";

function stubGatewayApis(
  fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  overrides: Record<string, unknown> = {},
) {
  const health = overrides.health ?? {
    reachable: false,
    latencyMs: null,
    modelCount: 0,
    lastError: "fetch failed",
    baseUrl: "http://127.0.0.1:20128/v1",
    configured: false,
    setupHint: "Cài OmniRoute rồi đặt OMNIROUTE_API_KEY",
  };
  const gateway = overrides.gateway ?? { mode: "off", mappings: [] };
  const catalog = overrides.catalog ?? { models: [], cachedAt: null, baseUrl: "http://127.0.0.1:20128/v1" };
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/settings/llm-gateway" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as unknown;
      (overrides as { savedGateway?: unknown }).savedGateway = body;
      return jsonResponse(body);
    }
    if (url === "/api/settings/llm-gateway") return jsonResponse(gateway);
    if (url === "/api/llm/providers/omniroute/health") return jsonResponse(health);
    if (url === "/api/llm/providers/omniroute/catalog/refresh") return jsonResponse(catalog);
    if (url === "/api/llm/providers/omniroute/catalog") return jsonResponse(catalog);
    const emptyQuota = {
      quotaPolicy: "wait",
      paidFallbackDailyUsd: 1,
      nearLimitRatio: 0.9,
      todaySpendUsd: 0,
      paidFallbackSpendToday: 0,
      rows: [],
      cooldowns: [],
    };
    if (url === "/api/llm/quota/policy" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { quotaPolicy: string; paidFallbackDailyUsd: number };
      (overrides as { savedPolicy?: unknown }).savedPolicy = body;
      return jsonResponse({ ...(overrides.quota as object ?? emptyQuota), ...body });
    }
    if (url.startsWith("/api/llm/quota")) return jsonResponse(overrides.quota ?? emptyQuota);
    return fetchMock(input, init);
  };
}

describe("AiSettingsPage", () => {
  it("renders task rows, applies routing presets, resets an override, and saves the task routes", { timeout: 30_000 }, async () => {
    let saved: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") {
        return jsonResponse([
          { id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" },
          { id: "copilot-cli", label: "Copilot CLI", configured: false, defaultModel: null, hint: "Sign in first" },
        ]);
      }
      if (url === "/api/settings/llm-routing" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body)) as unknown;
        return jsonResponse(saved);
      }
      if (url === "/api/settings/llm-routing") return jsonResponse({ tasks: { research: { provider: "mock", model: "old-model" } } });
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: ["mock-v1"] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(fetchMock));

    renderWithProviders(<AiSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Mô hình AI" })).toBeInTheDocument();
    expect(screen.getByText("Nghiên cứu")).toBeInTheDocument();
    expect(screen.getByText("Mô tả hình + từ khóa theo scene")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nhà cung cấp model mạnh"), { target: { value: "mock" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model mạnh" }), { target: { value: "strong-model" } });
    fireEvent.change(screen.getByLabelText("Nhà cung cấp model nhanh"), { target: { value: "mock" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model nhanh" }), { target: { value: "fast-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Một model cho tất cả" }));
    fireEvent.click(screen.getByRole("button", { name: "Mạnh cho viết, nhanh cho việc phụ" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Dùng mặc định" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));

    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({
      default: { provider: "mock", model: "strong-model" },
      tasks: {
        script: { provider: "mock", model: "strong-model" },
        sceneQueries: { provider: "mock", model: "fast-model" },
      },
    });
    expect((saved as { tasks: Record<string, unknown> }).tasks).not.toHaveProperty("research");
  });

  it("lays tasks out as cards with stage and tier chips and lists unconfigured providers as disabled", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") {
        return jsonResponse([
          { id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" },
          { id: "anthropic", label: "Anthropic API", configured: false, defaultModel: null, hint: "Set ANTHROPIC_API_KEY" },
        ]);
      }
      if (url === "/api/settings/llm-routing") return jsonResponse({});
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: [] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(inner));
    const { container } = renderWithProviders(<AiSettingsPage />);
    await screen.findByRole("heading", { name: "Mô hình AI" });
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelectorAll(".ai-task-card")).toHaveLength(LLM_TASKS.length);
    expect(container.querySelectorAll(".ai-task-card .ai-chip-strong").length).toBeGreaterThan(0);
    const option = screen.getByLabelText("Nghiên cứu — nhà cung cấp").querySelector('option[value="anthropic"]') as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain("chưa cấu hình");
  });

  it("shows every model of the chosen provider in a dropdown, not filtered by the typed text", async () => {
    const all = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-4-5"];
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "claude-cli", label: "Claude CLI", configured: true, defaultModel: null }]);
      if (url === "/api/settings/llm-routing") return jsonResponse({ default: { provider: "claude-cli", model: "claude-sonnet-5-5" } });
      if (url.includes("/models")) return jsonResponse({ provider: "claude-cli", models: all });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(inner));
    renderWithProviders(<AiSettingsPage />);
    await screen.findByRole("heading", { name: "Mô hình AI" });
    const select = await screen.findByRole("combobox", { name: "Model mặc định: chọn từ danh sách" }) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(all.length + 1));
    expect(select.value).toBe("claude-sonnet-5-5");
    fireEvent.change(select, { target: { value: "claude-haiku-4-5" } });
    expect(screen.getByRole("textbox", { name: "Model mặc định" })).toHaveValue("claude-haiku-4-5");
  });

  it("renders the OmniRoute gateway status and saves the mode", async () => {
    const overrides: { savedGateway?: unknown; health?: unknown; gateway?: unknown; catalog?: unknown } = {
      health: {
        reachable: true,
        latencyMs: 12,
        modelCount: 2,
        lastError: null,
        baseUrl: "http://127.0.0.1:20128/v1",
        configured: true,
        setupHint: "hint",
      },
      gateway: { mode: "off", mappings: [] },
      catalog: {
        models: [{ id: "cc/claude-sonnet", ownedBy: "anthropic" }],
        cachedAt: "2026-11-04T00:00:00.000Z",
        baseUrl: "http://127.0.0.1:20128/v1",
      },
    };
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" }]);
      if (url === "/api/settings/llm-routing") return jsonResponse({});
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: ["mock-v1"] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(inner, overrides));

    renderWithProviders(<AiSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Gateway OmniRoute" })).toBeInTheDocument();
    expect(screen.getByText("Đang chạy")).toBeInTheDocument();
    expect(document.querySelector(".ai-gateway-dot-up")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Chế độ gateway OmniRoute"), { target: { value: "prefer" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu gateway" }));

    await waitFor(() => expect(overrides.savedGateway).toEqual({ mode: "prefer", mappings: [] }));
    expect(await screen.findByText("Đã lưu cài đặt gateway.")).toBeInTheDocument();
  });

  it("renders quota statuses, reorders the fallback chain, and saves the wait policy", async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const overrides: Record<string, unknown> = {
      quota: {
        quotaPolicy: "wait",
        paidFallbackDailyUsd: 1,
        nearLimitRatio: 0.9,
        todaySpendUsd: 0,
        paidFallbackSpendToday: 0,
        cooldowns: [],
        rows: [
          row("gemini", "gemini-2.5-flash", "ok", 10, 250, null),
          row("groq", "*", "near", 90, 100, null),
          row("gemini", "gemini-2.5-pro", "exhausted", 100, 100, until),
        ],
      },
    };
    let saved: { tasks?: { research?: { fallbacks?: { model?: string }[] } } } | undefined;
    const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" }]);
      if (url === "/api/settings/llm-routing" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body));
        return jsonResponse(saved);
      }
      if (url === "/api/settings/llm-routing") {
        return jsonResponse({
          tasks: {
            research: {
              provider: "mock",
              model: "primary",
              fallbacks: [{ provider: "mock", model: "one" }, { provider: "mock", model: "two" }],
            },
          },
        });
      }
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: ["one", "two", "mock-v1"] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(inner, overrides));
    renderWithProviders(<AiSettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Quota" }));
    expect(await screen.findByText("Còn")).toBeInTheDocument();
    expect(screen.getByText("Sắp hết")).toBeInTheDocument();
    expect(screen.getByText(/Hết – chờ đến/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Chính sách quota"), { target: { value: "paid_fallback" } });
    fireEvent.change(screen.getByLabelText("Trần chi phí trả phí"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chính sách quota" }));
    await waitFor(() => expect(overrides.savedPolicy).toEqual({ quotaPolicy: "paid_fallback", paidFallbackDailyUsd: 2.5 }));

    fireEvent.click(screen.getByRole("button", { name: "Định tuyến" }));
    const down = await screen.findByRole("button", { name: "Đưa mock/one xuống" });
    fireEvent.click(down);
    fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));
    await waitFor(() => expect(saved?.tasks?.research?.fallbacks?.map((item) => item.model)).toEqual(["two", "one"]));
  });

  it("renders live OmniRoute quota cards", async () => {
    const overrides: Record<string, unknown> = {
      quota: quotaBody({
        status: "connected",
        fetchedAt: "2026-06-15T18:05:00.000Z",
        tokenSaved: true,
        tokenLast4: "1234",
        connections: [liveCard()],
      }),
    };
    vi.stubGlobal("fetch", stubGatewayApis(settingsFetch, overrides));
    renderWithProviders(<AiSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Quota" }));
    expect(await screen.findByText("Từ OmniRoute (số thật)")).toBeInTheDocument();
    const card = screen.getByTestId("omni-card-gh-1");
    expect(document.body.textContent).toMatch(/Đã kết nối OmniRoute/);
    expect(card.textContent).toMatch(/10 \/ 300 lượt/);
    expect(card.textContent).toMatch(/a\*\*\*@gmail\.com/);
    expect(document.body.textContent).toMatch(/đã lưu\s*1234/);
    expect(card.textContent).toMatch(/đang dùng cho:\s*Viết kịch bản/);
  });

  it("saves a management token and only shows the last four characters", async () => {
    const secret = "oma_live_secret1234";
    let posted = "";
    const quota = quotaBody({ status: "needs_token", tokenSaved: false, tokenLast4: null, message: "Cần token" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/llm/quota/omniroute/token" && init?.method === "PUT") {
        posted = JSON.parse(String(init.body)).token as string;
        return jsonResponse(quotaBody({ status: "connected", tokenSaved: true, tokenLast4: posted.slice(-4) }));
      }
      if (url.startsWith("/api/llm/quota")) return jsonResponse(quota);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" }]);
      if (url === "/api/settings/llm-routing") return jsonResponse({});
      if (url === "/api/settings/llm-gateway") return jsonResponse({ mode: "off", mappings: [] });
      if (url === "/api/llm/providers/omniroute/health") return jsonResponse({ reachable: false, latencyMs: null, modelCount: 0, lastError: null, baseUrl: "http://127.0.0.1:20128/v1", configured: false, setupHint: "" });
      if (url === "/api/llm/providers/omniroute/catalog") return jsonResponse({ models: [], cachedAt: null, baseUrl: "http://127.0.0.1:20128/v1" });
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: [] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AiSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Quota" }));
    expect(await screen.findByText(/Access Tokens/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Token quản trị OmniRoute"), { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu token" }));
    await waitFor(() => expect(posted).toBe(secret));
    await screen.findByText(/đã lưu/);
    expect(document.body.textContent).toMatch(/đã lưu\s*1234/);
    expect(screen.queryByLabelText("Token quản trị OmniRoute")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(secret);
  });

  it("lists routed models that have neither live quota nor a rule", async () => {
    const overrides: Record<string, unknown> = {
      quota: quotaBody({
        status: "connected",
        tokenSaved: false,
        missingModels: [{ provider: "omniroute", model: "cc/claude-sonnet", tasks: ["Viết kịch bản"] }],
      }),
    };
    vi.stubGlobal("fetch", stubGatewayApis(settingsFetch, overrides));
    renderWithProviders(<AiSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Quota" }));
    expect(await screen.findByText(/omniroute\/cc\/claude-sonnet/)).toBeInTheDocument();
    const row = screen.getByText(/omniroute\/cc\/claude-sonnet/).closest("li");
    fireEvent.click(row!.querySelector("button")!);
    expect(screen.getByLabelText("Model của quy tắc mới")).toHaveValue("cc/claude-sonnet");
    expect(screen.getByLabelText("Nhà cung cấp của quy tắc mới")).toHaveValue("omniroute");
  });
});

async function settingsFetch(input: RequestInfo | URL) {
  const url = String(input);
  if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
  if (url === "/api/llm/providers") return jsonResponse([{ id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" }]);
  if (url === "/api/settings/llm-routing") return jsonResponse({});
  if (url.includes("/models")) return jsonResponse({ provider: "mock", models: ["mock-v1"] });
  throw new Error(`Unexpected offline test request: ${url}`);
}

function quotaBody(omniroute: Record<string, unknown>) {
  return {
    quotaPolicy: "wait",
    paidFallbackDailyUsd: 1,
    nearLimitRatio: 0.9,
    todaySpendUsd: 0,
    paidFallbackSpendToday: 0,
    freeCreditSpendUsd: 0,
    rows: [],
    cooldowns: [],
    omniroute: {
      status: "idle",
      fetchedAt: null,
      tokenSaved: false,
      tokenLast4: null,
      dashboardUrl: "http://127.0.0.1:20128",
      message: null,
      connections: [],
      missingModels: [],
      ...omniroute,
    },
  };
}

function liveCard() {
  return {
    connectionId: "gh-1",
    provider: "github",
    appProvider: "copilot-cli",
    label: "Copilot",
    maskedAccount: "a***@gmail.com",
    active: true,
    fetchedAt: "2026-06-15T18:05:00.000Z",
    error: null,
    noQuotaData: false,
    tasks: ["Viết kịch bản"],
    rateLimitNote: null,
    manualRule: { provider: "copilot-cli", model: "*" },
    quotas: [{
      key: "premium_interactions",
      unit: "requests",
      used: 10,
      total: 300,
      remaining: 290,
      remainingPct: 96,
      resetAt: "2026-07-01T00:00:00.000Z",
      expiresAt: null,
      unlimited: false,
      fractionReported: true,
      status: "ok",
      display: "10 / 300 lượt",
      expiryLabel: null,
    }],
  };
}

function row(provider: string, model: string, status: "ok" | "near" | "exhausted", used: number, limit: number, until: string | null) {
  return {
    provider,
    model,
    kind: "free_tier" as const,
    source: "preset" as const,
    enabled: true,
    note: "ước tính",
    resetTz: "America/Los_Angeles",
    limits: [{ window: "day" as const, requests: limit }],
    windows: [{
      window: "day" as const,
      requestsUsed: used,
      requestsLimit: limit,
      inputTokensUsed: 0,
      inputTokensLimit: null,
      outputTokensUsed: 0,
      outputTokensLimit: null,
      ratio: used / limit,
    }],
    nextReset: until,
    status,
    cooldownUntil: status === "exhausted" ? until : null,
    cooldownReason: status === "exhausted" ? "daily-reset" : null,
  };
}
