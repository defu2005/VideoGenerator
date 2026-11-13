import { createHash, type KeyObject } from "node:crypto";
import {
  chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, statfsSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { hostname, cpus, totalmem } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  HeartbeatResponseSchema,
  JoinResponseSchema,
  LeaseResponseSchema,
  type ExecuteReport,
  type LeaseResponse,
  type NodeDesiredConfig,
  type NodeProbe,
  type RenderBundle,
} from "@vg/shared";
import { executeRender } from "../render/executeRender.js";
import { readAppVersion } from "../render/appVersion.js";
import type { ExecFfmpeg, ExecuteIo } from "../render/types.js";
import { runFfmpeg, resolveFfmpegPath } from "../media/ffmpeg.js";
import { sha256File } from "./artifactService.js";
import { PROBE_INTERVAL_MS, runRenderProbe } from "./probe.js";
import { newBoxKeyPair, openSecret } from "./secretBox.js";
import { SecretHolder, createNodeTtsRegistry, detectTtsCapabilities, runMediaBundle, runVoiceBundle } from "./remoteRunners.js";

/** Exit code used with VG_EXIT_FOR_UPDATE=1 so a restart policy (restart: on-failure) can bring the container back on the new image. */
export const EXIT_FOR_UPDATE_CODE = 75;

/*
 * Worker node agent (VG_ROLE=worker). No database, no LLM keys, no vault, no user auth:
 * it only talks to the control plane with its node token. It never logs a join token, a node token or file contents.
 */

const SFX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "sfx");

export type AgentEnv = Record<string, string | undefined>;

export type AgentDeps = {
  fetch?: typeof fetch;
  execute?: (bundle: RenderBundle, io: ExecuteIo) => Promise<{ outputPath: string; report: ExecuteReport }>;
  checkCapabilities?: () => Promise<string[]>;
  /** Real capability probe (ffmpeg + 1s HyperFrames render + ffprobe). Tests inject it; never spawns binaries then. */
  probe?: () => Promise<NodeProbe>;
  probeIntervalMs?: number;
  ffmpeg?: ExecFfmpeg;
  log?: (message: string) => void;
  heartbeatMs?: number;
  pollMs?: number;
};

class Revoked extends Error {}

/** Plain http is only fine on a private network. Loopback, RFC 1918 and 100.64.0.0/10 (Tailscale). */
export function isPrivateHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (name === "localhost" || name === "::1" || name.endsWith(".localhost")) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function controlUrlProblem(raw: string | undefined, allowInsecure: boolean): string | null {
  if (!raw) return "Thiếu VG_CONTROL_URL.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "VG_CONTROL_URL không phải địa chỉ hợp lệ.";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol !== "http:") return "VG_CONTROL_URL phải bắt đầu bằng https:// hoặc http://.";
  if (isPrivateHost(url.hostname) || allowInsecure) return null;
  return "Từ chối http:// tới địa chỉ công khai. Dùng https://, mạng riêng/Tailscale, hoặc đặt VG_ALLOW_INSECURE_CONTROL=true.";
}

async function defaultCapabilities(): Promise<string[]> {
  const ok = await new Promise<boolean>((done) => {
    try {
      const child = spawn(resolveFfmpegPath(), ["-version"], { stdio: "ignore" });
      child.on("error", () => done(false));
      child.on("exit", (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
  if (!ok) return [];
  try {
    const { createRequire } = await import("node:module");
    createRequire(import.meta.url).resolve("hyperframes/package.json");
  } catch {
    return [];
  }
  return ["render"];
}

function freeDiskMb(dir: string): number {
  try {
    const stat = statfsSync(dir);
    return Math.floor((Number(stat.bavail) * Number(stat.bsize)) / 1024 / 1024);
  } catch {
    return 0;
  }
}

type Running = {
  jobId: string;
  leaseId: string;
  progress: number;
  message: string;
  controller: AbortController;
  cancelled: boolean;
  promise: Promise<void>;
};

export class NodeAgent {
  private readonly base: string;
  private readonly dataDir: string;
  private readonly fetcher: typeof fetch;
  private readonly execute: NonNullable<AgentDeps["execute"]>;
  private readonly log: (message: string) => void;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;
  private readonly cacheMaxBytes: number;
  private readonly graceMs: number;
  private readonly running = new Map<string, Running>();
  private token: string | undefined;
  private desired: NodeDesiredConfig = { concurrency: 1, drain: false, capabilities: ["render"] };
  private capabilities: string[] = [];
  private probe: NodeProbe | undefined;
  private probing = false;
  private lastProbeAt = 0;
  private updateRequested = false;
  private stopping = false;
  private revoked = false;
  private wake: (() => void) | undefined;

  constructor(private readonly env: AgentEnv, private readonly deps: AgentDeps = {}) {
    this.base = (env.VG_CONTROL_URL ?? "").replace(/\/+$/, "");
    this.dataDir = resolvePath(env.DATA_DIR ?? "./data");
    this.fetcher = deps.fetch ?? fetch;
    this.execute = deps.execute ?? executeRender;
    this.log = deps.log ?? ((message) => console.log(`[worker] ${message}`));
    this.heartbeatMs = deps.heartbeatMs ?? 15_000;
    this.pollMs = deps.pollMs ?? 3_000;
    this.cacheMaxBytes = Math.max(1, Number(env.NODE_CACHE_MAX_GB ?? 20)) * 1024 ** 3;
    this.graceMs = Math.max(0, Number(env.NODE_SHUTDOWN_GRACE_SEC ?? 120)) * 1000;
  }

  private get tokenFile(): string {
    return join(this.dataDir, "secrets", "node.token");
  }

  /** Ask the loop to stop leasing, finish or hand back running jobs, then exit. */
  stop(): void {
    this.stopping = true;
    this.wake?.();
  }

  /** Runs until stopped or revoked. Returns the process exit code. */
  async run(): Promise<number> {
    const problem = controlUrlProblem(this.env.VG_CONTROL_URL, ["true", "1"].includes((this.env.VG_ALLOW_INSECURE_CONTROL ?? "").toLowerCase()));
    if (problem) {
      this.log(problem);
      return 1;
    }
    mkdirSync(this.dataDir, { recursive: true });
    this.capabilities = await (this.deps.checkCapabilities ?? defaultCapabilities)();
    if (!this.capabilities.includes("render")) this.log("Máy này chưa dựng được video (thiếu ffmpeg hoặc HyperFrames). Vẫn có thể nhận việc khác nếu khai báo.");
    else await this.runProbe();
    this.capabilities = [...this.capabilities, ...this.extraCapabilities()];
    try {
      this.token = existsSync(this.tokenFile) ? readFileSync(this.tokenFile, "utf8").trim() : undefined;
      if (!this.token) {
        const joined = await this.join();
        if (joined === "fatal") return 1;
      }
      await Promise.all([this.heartbeatLoop(), this.leaseLoop()]);
    } catch (error) {
      if (!(error instanceof Revoked)) throw error;
    }
    if (this.revoked) {
      rmSync(this.tokenFile, { force: true });
      this.log("Máy này đã bị thu hồi khỏi hệ thống. Dừng.");
      for (const job of this.running.values()) job.controller.abort();
      await Promise.all([...this.running.values()].map((job) => job.promise));
      return 0;
    }
    await this.shutdown();
    return this.updateRequested ? EXIT_FOR_UPDATE_CODE : 0;
  }

  /** tts:<provider> that really work here (CLI tools found, or listed in VG_NODE_TTS) and media_fetch. */
  private extraCapabilities(): string[] {
    const extra = detectTtsCapabilities(this.env, createNodeTtsRegistry(this.env, () => null));
    if ((this.env.VG_NODE_MEDIA ?? "true").toLowerCase() !== "false") extra.push("media_fetch");
    return extra;
  }

  private capabilityInfo(): Record<string, string> {
    const version = readAppVersion();
    return Object.fromEntries(this.capabilities.map((name) => [name, version]));
  }

  /** Runs the capability probe. Only called at startup and when no job is running. */
  private async runProbe(): Promise<void> {
    this.probing = true;
    try {
      this.probe = await (this.deps.probe ?? (() => runRenderProbe(this.dataDir)))();
    } catch (error) {
      this.probe = { render: { ok: false, reason: `Dựng thử lỗi: ${error instanceof Error ? error.message.slice(0, 160) : "không rõ"}`, checkedAt: new Date().toISOString() } };
    } finally {
      this.probing = false;
      this.lastProbeAt = Date.now();
    }
    if (!this.probe.render.ok) this.log(`Dựng thử không đạt: ${this.probe.render.reason ?? "không rõ"}. Máy sẽ không nhận việc cho tới lần kiểm tra sau.`);
  }

  private probeDue(): boolean {
    if (this.probing || this.running.size || !this.capabilities.includes("render")) return false;
    return Date.now() - this.lastProbeAt >= (this.deps.probeIntervalMs ?? PROBE_INTERVAL_MS);
  }

  private async join(): Promise<"ok" | "fatal"> {
    const joinToken = this.env.VG_JOIN_TOKEN;
    if (!joinToken) {
      this.log("Chưa có token máy và thiếu VG_JOIN_TOKEN. Tạo mã tham gia trong Cài đặt → Máy worker.");
      return "fatal";
    }
    let delay = 1000;
    while (!this.stopping) {
      try {
        const response = await this.fetcher(`${this.base}/api/nodes/agent/join`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            joinToken,
            name: this.env.VG_NODE_NAME || hostname(),
            version: readAppVersion(),
            capabilities: this.capabilities,
            capabilityInfo: this.capabilityInfo(),
            resources: this.resources(),
            ...(this.probe ? { probe: this.probe } : {}),
          }),
        });
        if (response.status === 401 || response.status === 400) {
          this.log("Mã tham gia không hợp lệ, đã dùng hoặc hết hạn. Tạo mã mới rồi chạy lại.");
          return "fatal";
        }
        if (!response.ok) throw new Error(`join ${response.status}`);
        const joined = JoinResponseSchema.parse(await response.json());
        this.token = joined.nodeToken;
        this.desired = joined.desiredConfig;
        mkdirSync(dirname(this.tokenFile), { recursive: true });
        writeFileSync(this.tokenFile, joined.nodeToken, { mode: 0o600 });
        try {
          chmodSync(this.tokenFile, 0o600);
        } catch {
          /* not supported on this OS */
        }
        this.log("Đã tham gia hệ thống.");
        return "ok";
      } catch (error) {
        this.log(`Chưa kết nối được (${error instanceof Error ? error.message : "lỗi"}). Thử lại.`);
        await this.sleep(delay);
        delay = Math.min(60_000, delay * 2);
      }
    }
    return "fatal";
  }

  private resources() {
    return { cpus: cpus().length, ramMb: Math.floor(totalmem() / 1024 / 1024), freeDiskMb: freeDiskMb(this.dataDir) };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((done) => {
      const timer = setTimeout(done, ms);
      timer.unref?.();
      const previous = this.wake;
      this.wake = () => {
        clearTimeout(timer);
        previous?.();
        done();
      };
    });
  }

  private backoff(attempt: number): number {
    return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)) * (0.5 + Math.random() * 0.5);
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetcher(`${this.base}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) {
      this.revoked = true;
      this.stopping = true;
      this.wake?.();
      throw new Revoked();
    }
    return response;
  }

  private async heartbeatLoop(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      try {
        const response = await this.call("/api/nodes/agent/heartbeat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: readAppVersion(),
            capabilities: this.capabilities,
            capabilityInfo: this.capabilityInfo(),
            resources: this.resources(),
            ...(this.probe ? { probe: this.probe } : {}),
            running: [...this.running.values()].filter((job) => !job.cancelled).map((job) => ({
              jobId: job.jobId, leaseId: job.leaseId, progress: job.progress, ...(job.message ? { message: job.message.slice(0, 300) } : {}),
            })),
          }),
        });
        if (!response.ok) throw new Error(`heartbeat ${response.status}`);
        const reply = HeartbeatResponseSchema.parse(await response.json());
        this.desired = reply.desiredConfig;
        failures = 0;
        if (this.exitForUpdate() && reply.targetVersion && reply.targetVersion !== readAppVersion() && !this.updateRequested) {
          this.updateRequested = true;
          this.log(`Phiên bản điều khiển là ${reply.targetVersion}, máy này đang ${readAppVersion()}. Ngừng nhận việc, chờ việc đang chạy xong rồi thoát (mã ${EXIT_FOR_UPDATE_CODE}) để cập nhật.`);
          this.wake?.();
        }
        for (const jobId of reply.cancel) {
          const job = this.running.get(jobId);
          if (job && !job.cancelled) {
            job.cancelled = true;
            job.controller.abort();
          }
        }
        if (this.probeDue()) await this.runProbe();
        await this.sleep(this.heartbeatMs);
      } catch (error) {
        if (error instanceof Revoked) throw error;
        failures += 1;
        await this.sleep(this.backoff(failures));
      }
    }
  }

  private exitForUpdate(): boolean {
    return ["1", "true"].includes((this.env.VG_EXIT_FOR_UPDATE ?? "").toLowerCase());
  }

  private async leaseLoop(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      if (this.updateRequested && !this.running.size) {
        // Heartbeats keep flowing while jobs finish; once idle we stop and run() exits with the update code.
        this.stopping = true;
        this.wake?.();
        break;
      }
      const free = this.desired.concurrency - this.running.size;
      const usable = this.capabilities.some((name) => this.desired.capabilities.includes(name) && (name !== "render" || this.probe?.render.ok !== false));
      const canTake = free > 0 && !this.desired.drain && usable && !this.probing && !this.updateRequested;
      if (!canTake) {
        await this.sleep(this.pollMs);
        continue;
      }
      try {
        // A fresh key pair per request. The private half stays in this process and goes away with the job.
        const pair = newBoxKeyPair();
        const response = await this.call("/api/nodes/agent/lease", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ freeSlots: Math.min(8, free), publicKey: pair.publicKey }),
        });
        if (response.status === 204) {
          failures = 0;
          await this.sleep(this.pollMs);
          continue;
        }
        if (!response.ok) throw new Error(`lease ${response.status}`);
        const lease = LeaseResponseSchema.parse(await response.json());
        failures = 0;
        this.start(lease, pair.privateKey);
      } catch (error) {
        if (error instanceof Revoked) throw error;
        failures += 1;
        await this.sleep(this.backoff(failures));
      }
    }
  }

  private start(lease: LeaseResponse, privateKey?: KeyObject): void {
    const controller = new AbortController();
    const job: Running = {
      jobId: lease.jobId, leaseId: lease.leaseId, progress: 5, message: "Nhận việc", controller, cancelled: false,
      promise: Promise.resolve(),
    };
    job.promise = (lease.stage === "RENDER" ? this.runJob(lease, job) : this.runRemoteStage(lease, job, privateKey)).catch((error: unknown) => {
      if (error instanceof Revoked) return;
      this.log(`Việc ${lease.jobId.slice(0, 8)} lỗi: ${error instanceof Error ? error.message : "không rõ"}`);
    }).finally(() => {
      this.running.delete(lease.jobId);
      this.wake?.();
    });
    this.running.set(lease.jobId, job);
  }

  private async download(lease: LeaseResponse, sha256: string, signal: AbortSignal): Promise<string> {
    const cacheDir = join(this.dataDir, "cache", "artifacts");
    mkdirSync(cacheDir, { recursive: true });
    const target = join(cacheDir, sha256);
    if (existsSync(target)) {
      const now = new Date();
      utimesSync(target, now, now);
      return target;
    }
    const response = await this.call(`/api/nodes/agent/artifacts/${sha256}?jobId=${encodeURIComponent(lease.jobId)}`, {
      headers: { "x-lease-id": lease.leaseId },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`Không tải được tệp ${sha256.slice(0, 8)} (${response.status})`);
    const temp = `${target}.${process.pid}.tmp`;
    const hash = createHash("sha256");
    const out = createWriteStream(temp);
    try {
      for await (const chunk of Readable.fromWeb(response.body as never)) {
        hash.update(chunk as Buffer);
        if (!out.write(chunk)) await new Promise<void>((done) => out.once("drain", () => done()));
      }
      await new Promise<void>((done, fail) => out.end((error?: Error | null) => (error ? fail(error) : done())));
    } catch (error) {
      out.destroy();
      rmSync(temp, { force: true });
      throw error;
    }
    if (hash.digest("hex") !== sha256) {
      rmSync(temp, { force: true });
      throw new Error(`Tệp ${sha256.slice(0, 8)} tải về bị sai mã sha256`);
    }
    renameSync(temp, target);
    return target;
  }

  private placeFile(cached: string, destination: string): void {
    mkdirSync(dirname(destination), { recursive: true });
    rmSync(destination, { force: true });
    try {
      linkSync(cached, destination);
    } catch {
      copyFileSync(cached, destination);
    }
  }

  private async upload(lease: LeaseResponse, name: string, file: string, signal: AbortSignal): Promise<string> {
    const sha256 = await sha256File(file);
    const size = statSync(file).size;
    const response = await this.call(`/api/nodes/agent/jobs/${lease.jobId}/outputs/${name}`, {
      method: "PUT",
      headers: { "x-lease-id": lease.leaseId, "x-sha256": sha256, "content-type": "application/octet-stream", "content-length": String(size) },
      body: Readable.toWeb(createReadStream(file)) as never,
      duplex: "half",
      signal,
    } as RequestInit);
    if (!response.ok) throw new Error(`Tải ${name} lên lỗi (${response.status})`);
    return sha256;
  }

  /** VOICE and MEDIA_FETCH. Own work dir, the lent key lives in memory and is wiped when the job ends. */
  private async runRemoteStage(lease: LeaseResponse, job: Running, privateKey?: KeyObject): Promise<void> {
    const { signal } = job.controller;
    const workDir = join(this.dataDir, "work", lease.jobId);
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    let holder: SecretHolder | undefined;
    const onProgress = (pct: number, message: string): void => {
      job.progress = Math.max(1, Math.min(99, Math.round(pct)));
      job.message = message;
    };
    try {
      let files: Array<{ name: string; path: string }>;
      const bundle = lease.bundle as { kind?: string };
      if (lease.stage === "VOICE" && bundle.kind === "tts") {
        const tts = lease.bundle as import("@vg/shared").TtsBundle;
        if (lease.secret) {
          if (!privateKey) throw new Error("Thiếu khoá riêng để mở khoá TTS.");
          if (lease.secret.scope !== `tts:${tts.provider}`) throw new Error("Khoá không đúng nhà cung cấp.");
          holder = new SecretHolder(openSecret(lease.secret, privateKey), lease.secret.scope, lease.secret.expiresAt);
          if (holder.expired()) throw new Error("Khoá đã hết hạn.");
        }
        const held = holder;
        const registry = createNodeTtsRegistry(
          this.env,
          () => (held && !held.expired() ? { scope: held.scope, value: held.get() } : null),
          this.deps.fetch ? { fetchImpl: this.deps.fetch } : {},
        );
        files = (await runVoiceBundle({ bundle: tts, workDir, registry, signal, onProgress })).files;
      } else if (lease.stage === "MEDIA_FETCH" && bundle.kind === "media") {
        files = (await runMediaBundle({ bundle: lease.bundle as import("@vg/shared").MediaBundle, workDir, fetchImpl: this.fetcher, signal, onProgress })).files;
      } else {
        throw new Error("Loại việc này máy không hỗ trợ.");
      }
      if (job.cancelled) return;
      job.message = "Gửi kết quả";
      const outputs: Array<{ name: string; sha256: string }> = [];
      for (const file of files) outputs.push({ name: file.name, sha256: await this.upload(lease, file.name, file.path, signal) });
      const done = await this.call(`/api/nodes/agent/jobs/${lease.jobId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId: lease.leaseId, outputs }),
      });
      if (done.status === 409 || done.status === 410) this.log(`Việc ${lease.jobId.slice(0, 8)} đã được giao lại, bỏ kết quả.`);
      else if (!done.ok) throw new Error(`complete ${done.status}`);
    } catch (error) {
      if (error instanceof Revoked || job.cancelled || signal.aborted) return;
      let message = (error instanceof Error ? error.message : "Lỗi không rõ");
      const plain = holder?.get();
      if (plain) message = message.split(plain).join("***");
      await this.call(`/api/nodes/agent/jobs/${lease.jobId}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId: lease.leaseId, code: `NODE_${lease.stage}_FAILED`, message: message.slice(0, 480), retryable: true }),
      }).catch(() => undefined);
    } finally {
      holder?.wipe();
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private async runJob(lease: LeaseResponse, job: Running): Promise<void> {
    const { signal } = job.controller;
    const renderBundle = lease.bundle as RenderBundle;
    const workDir = join(this.dataDir, "work", lease.jobId);
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    try {
      for (const file of lease.manifest) {
        job.message = "Tải dữ liệu";
        const cached = await this.download(lease, file.sha256, signal);
        this.placeFile(cached, join(workDir, file.name));
      }
      const renderDir = join(workDir, "render");
      mkdirSync(renderDir, { recursive: true });
      const clipCache = join(this.dataDir, "cache", "clips");
      mkdirSync(clipCache, { recursive: true });
      try {
        symlinkSync(clipCache, join(renderDir, "clips"), "junction");
      } catch {
        mkdirSync(join(renderDir, "clips"), { recursive: true });
      }
      const io: ExecuteIo = {
        resolve: (name) => join(workDir, name),
        dataDir: this.dataDir,
        renderDir,
        versionDir: join(renderDir, "versions", renderBundle.renderId),
        sfxDir: SFX_DIR,
        ffmpeg: this.deps.ffmpeg ?? ((args, options) => runFfmpeg(args, options)),
        signal,
        onProgress: (pct, message) => {
          job.progress = Math.max(1, Math.min(99, Math.round(pct)));
          job.message = message;
        },
      };
      const result = await this.execute(renderBundle, io);
      if (job.cancelled) return;
      job.message = "Gửi kết quả";
      const reportFile = join(workDir, "report.json");
      writeFileSync(reportFile, JSON.stringify(result.report));
      const outputs = [
        { name: "final.mp4", sha256: await this.upload(lease, "final.mp4", result.outputPath, signal) },
        { name: "report.json", sha256: await this.upload(lease, "report.json", reportFile, signal) },
      ];
      const done = await this.call(`/api/nodes/agent/jobs/${lease.jobId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId: lease.leaseId, outputs }),
      });
      if (done.status === 409) this.log(`Việc ${lease.jobId.slice(0, 8)} đã được giao lại, bỏ kết quả.`);
      else if (!done.ok) throw new Error(`complete ${done.status}`);
    } catch (error) {
      if (error instanceof Revoked || job.cancelled) return;
      if (signal.aborted) return;
      await this.call(`/api/nodes/agent/jobs/${lease.jobId}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseId: lease.leaseId,
          code: "NODE_RENDER_FAILED",
          message: (error instanceof Error ? error.message : "Lỗi không rõ").slice(0, 480),
          retryable: true,
        }),
      }).catch(() => undefined);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      this.evictCache();
    }
  }

  /** Oldest-used first, until the artifact cache fits. Clip cache is left to the clip hash reuse. */
  private evictCache(): void {
    const dir = join(this.dataDir, "cache", "artifacts");
    try {
      const files = readdirSync(dir).filter((name) => /^[0-9a-f]{64}$/.test(name)).map((name) => {
        const stat = statSync(join(dir, name));
        return { name, size: stat.size, at: stat.mtimeMs };
      }).sort((a, b) => a.at - b.at);
      let total = files.reduce((sum, file) => sum + file.size, 0);
      const inUse = new Set<string>();
      for (const file of files) {
        if (total <= this.cacheMaxBytes) break;
        if (inUse.has(file.name)) continue;
        rmSync(join(dir, file.name), { force: true });
        total -= file.size;
      }
    } catch {
      /* cache is best effort */
    }
  }

  /** SIGTERM: no new leases; wait for running jobs up to the grace period, then hand the rest back. */
  private async shutdown(): Promise<void> {
    if (!this.running.size) return;
    this.log("Đang dừng: chờ việc đang chạy xong.");
    const all = Promise.all([...this.running.values()].map((job) => job.promise));
    const timedOut = await Promise.race([all.then(() => false), new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(true), this.graceMs);
      timer.unref?.();
    })]);
    if (!timedOut) return;
    const leftover = [...this.running.values()];
    for (const job of leftover) {
      job.cancelled = true;
      job.controller.abort();
      await this.call(`/api/nodes/agent/jobs/${job.jobId}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId: job.leaseId, code: "NODE_SHUTDOWN", message: "Máy worker đang tắt.", retryable: true }),
      }).catch(() => undefined);
    }
    await Promise.all(leftover.map((job) => job.promise));
  }
}

/** Entry for `VG_ROLE=worker`. Returns the exit code. */
export async function runWorkerAgent(env: AgentEnv = process.env, deps: AgentDeps = {}): Promise<number> {
  const agent = new NodeAgent(env, deps);
  const onSignal = () => agent.stop();
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  try {
    return await agent.run();
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
}
