import { describe, expect, it } from "vitest";
import { signWebhook } from "../src/events/webhookSign.js";

describe("Standard Webhooks", () => {
  it("matches the specification test vector", () => {
    const signature = signWebhook(
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "1614265330",
      "{\"test\": 2432232314}",
      "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
    );
    expect(signature).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });
});
