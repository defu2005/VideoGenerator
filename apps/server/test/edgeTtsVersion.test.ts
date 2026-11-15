import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import {
  clearEdgeTtsVersionCache,
  compareSemver,
  EDGE_TTS_MIN_VERSION,
  edgeTtsVersion,
  EdgeTtsProvider,
  parseEdgeTtsVersion,
} from "../src/providers/tts/edgeTts.js";
import { registerHealthRoutes } from "../src/api/health.js";
import { runProviderFallback } from "@vg/shared";
import { StageError } from "../src/pipeline/stageExecutor.js";

function fakeSpawnWithOutput(stdoutText: string, stderrText = "", exitCode = 0) {
  let callCount = 0;
  const calls: { args: readonly string[]; options: SpawnOptions }[] = [];
  const spawnProcess = ((...input: Parameters<typeof spawn>) => {
    const [, args, options] = input;
    callCount += 1;
    calls.push({ args: args ?? [], options: options ?? {} });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      if (stdoutText) child.stdout.write(stdoutText);
      if (stderrText) child.stderr.write(stderrText);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", exitCode);
    });
    return child as unknown as ReturnType<typeof spawn>;
  }) as typeof spawn;
  return { spawnProcess, calls, getCallCount: () => callCount };
}

describe("edge-tts version check", () => {
  beforeEach(() => {
    clearEdgeTtsVersionCache();
  });

  afterEach(() => {
    clearEdgeTtsVersionCache();
    vi.restoreAllMocks();
  });

  describe("output parsing", () => {
    it("parses normal --version output", () => {
      expect(parseEdgeTtsVersion("7.3.1")).toBe("7.3.1");
      expect(parseEdgeTtsVersion("edge-tts 7.3.1")).toBe("7.3.1");
      expect(parseEdgeTtsVersion("edge-tts v7.3.1")).toBe("7.3.1");
    });

    it("parses output with prefix or extra text", () => {
      expect(parseEdgeTtsVersion("Python 3.11.2 / edge-tts 7.3.1")).toBe("7.3.1");
      expect(parseEdgeTtsVersion("edge-tts, version 7.3.1.post1")).toBe("7.3.1");
      expect(parseEdgeTtsVersion("prefix edge_tts 7.3.1 suffix")).toBe("7.3.1");
    });

    it("returns null for garbage or non-semver output", () => {
      expect(parseEdgeTtsVersion("")).toBeNull();
      expect(parseEdgeTtsVersion("command not found")).toBeNull();
      expect(parseEdgeTtsVersion("Traceback (most recent call last):\n  File ...")).toBeNull();
      expect(parseEdgeTtsVersion("unknown error")).toBeNull();
    });
  });

  describe("compareSemver", () => {
    it("compares versions correctly", () => {
      expect(compareSemver("7.3.1", "7.3.1")).toBe(0);
      expect(compareSemver("6.9.9", "7.0.0")).toBe(-1);
      expect(compareSemver("7.2.5", "7.3.1")).toBe(-1);
      expect(compareSemver("7.3.0", "7.3.1")).toBe(-1);
      expect(compareSemver("7.3.2", "7.3.1")).toBe(1);
      expect(compareSemver("8.0.0", "7.3.1")).toBe(1);
    });
  });

  describe("edgeTtsVersion execution & caching", () => {
    it("holds the cache for 10 minutes", async () => {
      let clock = 1_000_000;
      const fake = fakeSpawnWithOutput("edge-tts 7.3.1\n");
      const res1 = await edgeTtsVersion("edge-tts.exe", {
        spawnProcess: fake.spawnProcess,
        now: () => clock,
      });
      expect(res1).toEqual({
        path: "edge-tts.exe",
        version: "7.3.1",
        status: "OK",
        outdated: false,
      });
      expect(fake.getCallCount()).toBe(1);

      // Call again 5 minutes later -> should return cached result without spawn
      clock += 5 * 60 * 1000;
      const res2 = await edgeTtsVersion("edge-tts.exe", {
        spawnProcess: fake.spawnProcess,
        now: () => clock,
      });
      expect(res2).toEqual(res1);
      expect(fake.getCallCount()).toBe(1);

      // Call after 11 minutes -> expired, spawns again
      clock += 6 * 60 * 1000;
      const res3 = await edgeTtsVersion("edge-tts.exe", {
        spawnProcess: fake.spawnProcess,
        now: () => clock,
      });
      expect(res3).toEqual(res1);
      expect(fake.getCallCount()).toBe(2);
    });

    it("marks version below minimum as outdated with update command", async () => {
      const fake = fakeSpawnWithOutput("edge-tts 6.1.3\n");
      const res = await edgeTtsVersion("edge-tts.exe", {
        spawnProcess: fake.spawnProcess,
      });
      expect(res.outdated).toBe(true);
      expect(res.version).toBe("6.1.3");
      expect(res.status).toBe("cũ — chạy: pip install -U edge-tts");
    });

    it("an unknown version does not report false outdated", async () => {
      const fake = fakeSpawnWithOutput("Some random garbage output without semver\n");
      const res = await edgeTtsVersion("edge-tts.exe", {
        spawnProcess: fake.spawnProcess,
      });
      expect(res.outdated).toBe(false);
      expect(res.version).toBe("unknown");
      expect(res.status).toBe("unknown");
    });
  });

  describe("/api/health integration", () => {
    it("shows cũ with pip command in details when version is below minimum", async () => {
      const fake = fakeSpawnWithOutput("edge-tts 6.0.0\n");
      const db = new Database(":memory:");
      db.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, stage TEXT, status TEXT);");
      const app = Fastify();
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      registerHealthRoutes(app, db, 1, "custom-edge-tts");

      // Inject custom version check
      vi.spyOn(globalThis, "fetch");
      const res = await app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.status).toBe("ok");
      expect(json.details).toBeDefined();
      expect(json.details.edgeTts).toEqual({
        version: "unknown",
        path: "custom-edge-tts",
        status: "unknown",
      });

      // Now with mocked spawn returning outdated version
      clearEdgeTtsVersionCache();
      const fakeOutdated = fakeSpawnWithOutput("edge-tts 6.0.0\n");
      await edgeTtsVersion("custom-edge-tts", {
        spawnProcess: fakeOutdated.spawnProcess,
        minVersion: EDGE_TTS_MIN_VERSION,
      });

      const resOutdated = await app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(resOutdated.statusCode).toBe(200);
      const bodyOutdated = resOutdated.json();
      expect(bodyOutdated.details.edgeTts.version).toBe("6.0.0");
      expect(bodyOutdated.details.edgeTts.status).toContain("cũ");
      expect(bodyOutdated.details.edgeTts.status).toContain("pip install -U edge-tts");
      db.close();
      await app.close();
    });
  });

  describe("synthesis error mapping to TTS_BINARY_OUTDATED", () => {
    it("maps failure on old version to TTS_BINARY_OUTDATED (non-retryable)", async () => {
      const fake = fakeSpawnWithOutput("", "WSServerHandshakeError: 403 Forbidden", 1);
      const provider = new EdgeTtsProvider("edge-tts.exe", 1000, {
        spawnProcess: fake.spawnProcess,
        probeDuration: vi.fn(async () => 1),
        sleep: vi.fn(async () => undefined),
        versionChecker: async () => ({
          path: "edge-tts.exe",
          version: "6.1.0",
          status: "cũ — chạy: pip install -U edge-tts",
          outdated: true,
        }),
      });

      let caughtError: unknown;
      try {
        await provider.synthesize({
          text: "hello",
          voice: "vi-VN-HoaiMyNeural",
          rate: "+0%",
          outPath: "out.mp3",
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(StageError);
      const stageErr = caughtError as StageError;
      expect(stageErr.code).toBe("TTS_BINARY_OUTDATED");
      expect(stageErr.retryable).toBe(false);
      expect(stageErr.message).toContain("pip install -U edge-tts");
    });

    it("does not map failure to TTS_BINARY_OUTDATED when version is unknown", async () => {
      const fake = fakeSpawnWithOutput("", "Invalid voice parameter", 1);
      const provider = new EdgeTtsProvider("edge-tts.exe", 1000, {
        spawnProcess: fake.spawnProcess,
        probeDuration: vi.fn(async () => 1),
        sleep: vi.fn(async () => undefined),
        versionChecker: async () => ({
          path: "edge-tts.exe",
          version: "unknown",
          status: "unknown",
          outdated: false,
        }),
      });

      await expect(
        provider.synthesize({
          text: "hello",
          voice: "vi-VN-HoaiMyNeural",
          rate: "+0%",
          outPath: "out.mp3",
        }),
      ).rejects.toThrow(/Invalid voice parameter/);
    });
  });

  describe("provider failover", () => {
    it("treats TTS_BINARY_OUTDATED like not configured and lets another provider take over", async () => {
      const calls: string[] = [];
      const result = await runProviderFallback({
        chain: ["edge-tts", "piper"],
        isAvailable: () => true,
        run: async (id) => {
          calls.push(id);
          if (id === "edge-tts") {
            throw new StageError(
              "Phiên bản edge-tts đã cũ — chạy: pip install -U edge-tts",
              "TTS_BINARY_OUTDATED",
              false,
            );
          }
          return { audio: "piper-ok" };
        },
      });

      // edge-tts was not retried, piper took over
      expect(calls).toEqual(["edge-tts", "piper"]);
      expect(result.id).toBe("piper");
      expect(result.value).toEqual({ audio: "piper-ok" });
    });
  });
});
