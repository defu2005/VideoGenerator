import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiRequest } from "./apiClient";

describe("apiRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the shared API error envelope into ApiRequestError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "PROJECT_BUSY", message: "Project is currently running", details: { id: "p1" } },
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(apiRequest("/projects/p1", { method: "DELETE" })).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_BUSY",
      message: "Project is currently running",
      details: { id: "p1" },
    } satisfies Partial<ApiRequestError>);
  });

  it("returns undefined for a successful 204 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest<void>("/projects/p1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
