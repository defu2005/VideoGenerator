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
  });
});
