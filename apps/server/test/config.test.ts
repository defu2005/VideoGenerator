import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/lib/config.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("server configuration", () => {
  it("resolves relative data and database paths from the repository root", () => {
    expect(parseConfig({ DATA_DIR: "./custom-data", DATABASE_PATH: "./custom-data/app.db" }))
      .toMatchObject({
        DATA_DIR: resolve(repositoryRoot, "custom-data"),
        DATABASE_PATH: resolve(repositoryRoot, "custom-data", "app.db"),
      });
  });

  it("defaults the research mode to the merged single-call flow", () => {
    expect(parseConfig({}).LLM_RESEARCH_MODE).toBe("merged");
    expect(parseConfig({}).USD_VND_RATE).toBe(26000);
    expect(parseConfig({ USD_VND_RATE: "25000" }).USD_VND_RATE).toBe(25000);
    expect(parseConfig({}).IMAGE_SEARCH_USER_AGENT).toContain("http");
    expect(parseConfig({}).IMAGE_DOWNLOAD_MIN_INTERVAL_MS).toBe(1000);
  });

  it("parses optional token limits and Copilot CLI configuration", () => {
    expect(parseConfig({
      OPENAI_MAX_INPUT_TOKENS: "8000",
      OPENAI_MAX_OUTPUT_TOKENS: "4000",
      COPILOT_CLI_ENABLED: "true",
      COPILOT_CLI_PATH: "copilot",
      COPILOT_CLI_MODEL: "auto",
    })).toMatchObject({
      LLM_PROVIDER_LIMITS: { openai: { maxInputTokens: 8000, maxOutputTokens: 4000 } },
      COPILOT_CLI_ENABLED: true,
      COPILOT_CLI_PATH: "copilot",
      COPILOT_CLI_MODEL: "auto",
    });
  });

  it("rejects malformed optional provider token limits", () => {
    expect(() => parseConfig({ OPENAI_MAX_OUTPUT_TOKENS: "0" }))
      .toThrow("OPENAI_MAX_OUTPUT_TOKENS: expected a positive integer");
  });
});
