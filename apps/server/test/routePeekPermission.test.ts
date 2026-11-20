import { describe, expect, it } from "vitest";
import { findRule } from "../src/auth/routePermissions.js";

describe("route rule for the mailbox peek", () => {
  it("maps the peek to mailbox.use, not the broader /api/agents* settings.read rule", () => {
    const rule = findRule("GET", "/api/agents/mailbox/peek");
    expect(rule?.action).toBe("mailbox.use");
    expect(findRule("GET", "/api/agents/bundle")?.action).toBe("settings.read");
  });
});
