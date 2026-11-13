import { describe, expect, it } from "vitest";
import { validatePlatformAppInput } from "../src/connections/catalog.js";

describe("platform app input", () => {
  const id = "1234-fixture.apps.googleusercontent.com";
  const secret = "GOCSPX-fixture";
  it("validates Google format and accepts legacy secrets with a warning", () => {
    expect(validatePlatformAppInput("youtube", { clientId: `  ${id} `, clientSecret: secret })).toEqual({ ok: true, errors: {}, warnings: [] });
    expect(validatePlatformAppInput("youtube", { clientId: id, clientSecret: "legacy" })).toMatchObject({ ok: true, warnings: [expect.any(String)] });
  });
  it("rejects emails, swapped values, blank fields and internal whitespace", () => {
    expect(validatePlatformAppInput("youtube", { clientId: "fixture@example.test", clientSecret: "" }).errors).toMatchObject({
      clientId: expect.stringContaining("Đây là email"), clientSecret: expect.any(String),
    });
    expect(validatePlatformAppInput("youtube", { clientId: secret, clientSecret: id }).errors).toMatchObject({
      clientId: expect.any(String), clientSecret: expect.any(String),
    });
    expect(validatePlatformAppInput("tiktok", { clientId: "fixture key", clientSecret: "x\ny" }).ok).toBe(false);
    expect(validatePlatformAppInput("facebook_reels", { clientId: "app-123", clientSecret: "secret" }).ok).toBe(false);
  });
});
