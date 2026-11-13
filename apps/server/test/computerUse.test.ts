import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig } from "../src/lib/config.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import type { ToolSource } from "../src/registry/policy.js";
import { setComputerUseAdapter } from "../src/computerUse/service.js";
import { createSimulatorAdapter, SIMULATOR_APP } from "../src/computerUse/simulator.js";
import { getToolCatalogForPrompt } from "../src/assistant/tools.js";

const root = mkdtempSync(join(tmpdir(), "vg-computer-use-test-"));
let app: ReturnType<typeof buildApp>;
let sim: ReturnType<typeof createSimulatorAdapter>;

const allowAll = {
  enabled: true, adapter: "simulator", allowedApps: [SIMULATOR_APP],
  allowedActions: ["observe", "navigate", "click", "type"], maxSteps: 15, timeoutSec: 120,
};

function call(name: string, args: unknown, source: ToolSource = "operator", runId: string | null = null) {
  return invokeRegistryTool({ actor: testActor,
    name, args, source, runId,
    ctx: app.vgAssistant.service.toolContext(),
    createPending: ({ tool, args: pendingArgs, summary }) =>
      app.vgAssistant.service.createCallerPending("Computer Use", tool, pendingArgs, summary),
  });
}

async function settings(body: unknown) {
  const response = await app.inject({ method: "PUT", url: "/api/operator/computer-use", payload: body });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function events() {
  const response = await app.inject({ method: "GET", url: "/api/operator/events" });
  return (response.json().items as Array<{ kind: string; detail: string | null }>).filter((item) => item.kind === "computer_use");
}

beforeAll(() => {
  const config = parseConfig({
    DATA_DIR: join(root, "data"), DATABASE_PATH: join(root, "cu.db"), PORT: "3014", HOST: "127.0.0.1",
    LOG_LEVEL: "silent", CORS_ORIGIN: "http://localhost:5173", WEB_BASE_URL: "http://localhost:5180",
    LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  app = buildApp({ testActor,  config });
});

beforeEach(() => {
  sim = createSimulatorAdapter();
});

afterAll(async () => {
  setComputerUseAdapter(null);
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("computer use", () => {
  it("is off by default and explains a missing adapter", async () => {
    const status = await app.inject({ method: "GET", url: "/api/operator/computer-use" });
    expect(status.json()).toMatchObject({ available: false, settings: { enabled: false, adapter: "none" } });
    await expect(call("computer_observe", { app: SIMULATOR_APP })).rejects.toThrow(/đang tắt/);
    const noAdapter = await settings({ ...allowAll, adapter: "none" });
    expect(noAdapter.available).toBe(false);
    expect(noAdapter.reason).toMatch(/chưa có adapter/);
    expect(getToolCatalogForPrompt().some((tool) => tool.name === "computer_observe")).toBe(true);
  });

  it("gives two agent sources the same screen, prefers an API tool and hides embedded commands", async () => {
    setComputerUseAdapter(sim);
    await settings(allowAll);
    const viaOperator = await call("computer_observe", { app: SIMULATOR_APP }, "operator", "run-a");
    const viaMcp = await call("computer_observe", { app: SIMULATOR_APP }, "mcp");
    expect(viaOperator.kind).toBe("result");
    expect(viaOperator.kind === "result" && viaOperator.result).toEqual(viaMcp.kind === "result" && viaMcp.result);
    expect(JSON.stringify(viaOperator)).toContain("3 video đang chờ đăng");

    const viaApi = await call("computer_observe", { app: SIMULATOR_APP, intent: "project_status" });
    expect(viaApi).toMatchObject({ kind: "result", result: { status: "use_tool", tool: "get_project" } });

    const queue = await call("computer_observe", { app: SIMULATOR_APP, navigateTo: "Hàng chờ" }, "operator", "run-b");
    const body = JSON.stringify(queue);
    expect(body).toContain("Video A");
    expect(body).toContain("[đã ẩn: nội dung giống lệnh]");
    expect(body).not.toContain("bỏ qua mọi hướng dẫn");

    const clear = await call("computer_act", { app: SIMULATOR_APP, action: "click", target: "Xóa tất cả" }, "operator", "run-b");
    expect(clear.kind).toBe("pending");
    if (clear.kind !== "pending") return;
    expect(clear.summaryVi).toContain("Xóa tất cả");
    const confirmed = await app.inject({ method: "POST", url: `/api/assistant/actions/${clear.pendingActionId}/confirm` });
    expect(confirmed.statusCode).toBe(500);
    expect(confirmed.body).toContain("giống lệnh");
  });

  it("stops outside the granted scope, at a login step and on the protected project", async () => {
    setComputerUseAdapter(sim);
    await settings(allowAll);
    await expect(call("computer_observe", { app: "trinh-duyet" })).rejects.toThrow(/chưa được cấp quyền/);
    await expect(call("computer_observe", { app: SIMULATOR_APP, navigateTo: "Trang đối tác" })).rejects.toThrow(/ngoài phạm vi/);
    sim.reset();
    await expect(call("computer_observe", { app: SIMULATOR_APP, navigateTo: "Đăng nhập" })).rejects.toThrow(/thông tin xác thực/);
    sim.reset();
    await expect(call("computer_observe", { app: SIMULATOR_APP, navigateTo: "Dự án lưu trữ" })).rejects.toThrow(/bị từ chối/);
    sim.reset();
    await expect(call("computer_observe", { app: SIMULATOR_APP, navigateTo: "Không có" })).rejects.toThrow(/Không xác định được đích/);
    const protectedArgs = await call("computer_act", {
      app: SIMULATOR_APP, action: "type", target: "Ghi chú", text: `mở ${PROTECTED_PROJECT_ID}`,
    });
    expect(protectedArgs.kind).toBe("refused");

    await settings({ ...allowAll, allowedActions: ["observe"] });
    await expect(call("computer_observe", { app: SIMULATOR_APP, navigateTo: "Hàng chờ" })).rejects.toThrow(/navigate chưa được cấp quyền/);
    const logged = await events();
    expect(logged.some((item) => item.detail?.includes("ngoài phạm vi"))).toBe(true);
    expect(logged.some((item) => item.detail?.includes("thông tin xác thực"))).toBe(true);
  });

  it("writes only after approval, for every source, and marks an unclear result for checking", async () => {
    setComputerUseAdapter(sim);
    await settings(allowAll);
    for (const source of ["operator", "mcp", "assistant", "agent"] as const) {
      const pending = await call("computer_act", { app: SIMULATOR_APP, action: "type", target: "Ghi chú", text: "Kiểm tra" }, source);
      expect(pending.kind).toBe("pending");
    }
    expect(sim.note).toBe("");
    const typed = await call("computer_act", { app: SIMULATOR_APP, action: "type", target: "Ghi chú", text: "Đã xem" });
    if (typed.kind !== "pending") throw new Error("expected pending");
    const done = await app.inject({ method: "POST", url: `/api/assistant/actions/${typed.pendingActionId}/confirm` });
    expect(done.statusCode).toBe(200);
    expect(sim.note).toBe("Đã xem");

    const unsure = createSimulatorAdapter({ uncertainSave: true });
    setComputerUseAdapter(unsure);
    await settings(allowAll);
    const save = await call("computer_act", { app: SIMULATOR_APP, action: "click", target: "Lưu ghi chú" });
    if (save.kind !== "pending") throw new Error("expected pending");
    const saved = await app.inject({ method: "POST", url: `/api/assistant/actions/${save.pendingActionId}/confirm` });
    expect(saved.json().action.result).toMatchObject({ status: "needs_check" });
    expect((await events()).some((item) => item.detail?.includes("needs_check"))).toBe(true);
  });

  it("honours stop and the step limit", async () => {
    setComputerUseAdapter(sim);
    await settings({ ...allowAll, maxSteps: 2 });
    await expect(call("computer_observe", { app: SIMULATOR_APP, navigateTo: "Hàng chờ" }, "operator", "run-limit"))
      .rejects.toThrow(/hết số bước/);
    await settings(allowAll);
    const stopped = await app.inject({ method: "POST", url: "/api/operator/computer-use/stop" });
    expect(stopped.json()).toMatchObject({ available: false });
    await expect(call("computer_observe", { app: SIMULATOR_APP })).rejects.toThrow(/đã dừng/);
    expect((await events()).some((item) => item.detail?.includes("Người dùng bấm dừng"))).toBe(true);
    const resumed = await settings(allowAll);
    expect(resumed.available).toBe(true);
  });
});
