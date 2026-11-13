import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "./apiClient";

describe("signInErrorMessage", () => {
  it("only blames the password on 401", () => {
    expect(signInErrorMessage(401, "INVALID_EMAIL_OR_PASSWORD")).toBe("Email hoặc mật khẩu không đúng.");
    expect(signInErrorMessage(403, "INVALID_ORIGIN")).toContain("không chấp nhận địa chỉ");
    expect(signInErrorMessage(429)).toContain("quá nhiều lần");
    expect(signInErrorMessage(502)).toContain("lỗi 502");
  });
});
