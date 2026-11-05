import { LlmQuotaRuleSchema, type LlmQuotaRule } from "../schemas/llmQuota.js";

const NOTE = "ước tính, kiểm tra trang nhà cung cấp";

const RAW_PRESETS: LlmQuotaRule[] = [
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    kind: "free_tier",
    limits: [
      { window: "minute", requests: 10 },
      { window: "day", requests: 250 },
    ],
    resetTz: "America/Los_Angeles",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    kind: "free_tier",
    limits: [
      { window: "minute", requests: 15 },
      { window: "day", requests: 1_000 },
    ],
    resetTz: "America/Los_Angeles",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    kind: "free_tier",
    limits: [
      { window: "minute", requests: 5 },
      { window: "day", requests: 100 },
    ],
    resetTz: "America/Los_Angeles",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
  {
    provider: "openrouter",
    model: "*:free",
    kind: "free_tier",
    limits: [
      { window: "minute", requests: 20 },
      { window: "day", requests: 50 },
    ],
    resetTz: "America/Los_Angeles",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
  {
    provider: "groq",
    model: "*",
    kind: "free_tier",
    limits: [
      { window: "minute", requests: 30 },
      { window: "day", requests: 14_400 },
    ],
    resetTz: "America/Los_Angeles",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
  {
    provider: "copilot-cli",
    model: "*",
    kind: "subscription",
    limits: [{ window: "month", requests: 300 }],
    resetTz: "UTC",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
  {
    provider: "antigravity-cli",
    model: "*",
    kind: "subscription",
    limits: [{ window: "day", requests: 50 }],
    resetTz: "America/Los_Angeles",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
  {
    provider: "claude-cli",
    model: "*",
    kind: "subscription",
    limits: [{ window: "rolling_5h", requests: 45 }],
    resetTz: "UTC",
    note: NOTE,
    source: "preset",
    enabled: true,
  },
];

export const LLM_QUOTA_PRESETS: LlmQuotaRule[] = RAW_PRESETS.map((rule) => LlmQuotaRuleSchema.parse(rule));
export const LLM_QUOTA_PRESET_NOTE = NOTE;
