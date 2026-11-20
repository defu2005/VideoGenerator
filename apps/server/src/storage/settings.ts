import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import { blobLocationId, type BlobLocation } from "./blobStore.js";
import { S3StorageProvider } from "./provider.js";
import { recordStorageHealth, storageHealth } from "./health.js";

const settingKey = "storage_provider";
const credentialsKey = "storage.s3.credentials";

const EndpointSchema = z.string().max(2048).refine((input) => {
  try {
    const url = new URL(input);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}, "Endpoint phải là URL HTTP/HTTPS, không chứa thông tin đăng nhập hay tham số.");

export const StorageSettingsSchema = z.object({
  provider: z.enum(["local", "s3"]),
  endpoint: EndpointSchema.or(z.literal("")),
  bucket: z.string().max(63).regex(/^(?:[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])?$/),
  region: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  checksumSha256: z.boolean(),
}).strict();
type StorageSettings = z.infer<typeof StorageSettingsSchema>;

const CredentialsSchema = z.object({
  accessKeyId: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
  secretAccessKey: z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/),
}).strict();
export const StorageSettingsUpdateSchema = z.object({
  settings: StorageSettingsSchema,
  credentials: CredentialsSchema.optional(),
}).strict();

const defaultSettings: StorageSettings = { provider: "local", endpoint: "", bucket: "", region: "auto", checksumSha256: true };

type ReadVault = Pick<TokenVault, "loadSecret" | "hasSecret" | "storeSecret">;

export class StorageSettingsStore {
  constructor(
    private readonly db: Database.Database,
    private readonly vault: ReadVault,
    private readonly request: typeof fetch = fetch,
  ) {}

  read(): StorageSettings {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key=?").get(settingKey) as { value: string } | undefined;
    if (!row) return { ...defaultSettings };
    try {
      const parsed = StorageSettingsSchema.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data;
    } catch { /* Keep local storage if a persisted setting is invalid. */ }
    return { ...defaultSettings };
  }

  status() {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const location = this.location();
    const mirrored = location && this.db.prepare("SELECT coalesce(sum(size),0) AS bytes FROM blobs WHERE location_id=? AND stored_at>=?")
      .get(location.id, start.toISOString()) as { bytes: number } | undefined;
    return {
      ...this.read(), credentialsConfigured: this.vault.hasSecret(credentialsKey),
      health: storageHealth(this.db), mirroredBytesToday: mirrored?.bytes ?? 0,
    };
  }

  private credentials() {
    const saved = this.vault.loadSecret(credentialsKey);
    if (!saved) return undefined;
    const parsed = CredentialsSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  }

  update(value: StorageSettings, replacement?: z.input<typeof CredentialsSchema>): void {
    const settings = StorageSettingsSchema.parse(value);
    const credentials = replacement && CredentialsSchema.parse(replacement);
    this.db.transaction(() => {
      if (settings.provider === "s3") {
        const active = credentials ?? this.credentials();
        if (!active || !settings.endpoint || !settings.bucket) {
          throw new AppError(400, "STORAGE_CONFIG_INCOMPLETE", "Cần endpoint, bucket và khóa S3 để bật lưu trữ trực tiếp.");
        }
        // Validate before committing configuration or credentials.
        new S3StorageProvider({ ...settings, ...active }, this.request);
      }
      if (credentials) this.vault.storeSecret(credentialsKey, JSON.stringify(credentials));
      this.db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .run(settingKey, JSON.stringify(settings), new Date().toISOString());
    }).immediate();
  }

  location(): BlobLocation | null {
    const settings = this.read();
    if (settings.provider === "local") return null;
    try {
      const credentials = this.credentials();
      if (!credentials) return null;
      const provider = new S3StorageProvider({ ...settings, ...credentials }, this.request);
      return { provider, id: blobLocationId(settings.endpoint, settings.bucket) };
    } catch {
      return null;
    }
  }

  async probe(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const location = this.location();
    if (!location) return { ok: this.read().provider === "local", latencyMs: 0 };
    const started = Date.now();
    const { provider } = location;
    const key = `probes/${randomUUID()}`;
    const dir = await mkdtemp(join(tmpdir(), "vg-storage-probe-"));
    const source = join(dir, "input");
    const target = join(dir, "output");
    let failed = false;
    try {
      const sample = Buffer.alloc(1024, 0x76);
      const sha = createHash("sha256").update(sample).digest("hex");
      await writeFile(source, sample);
      await provider.put(key, source, sha);
      const remote = await provider.head(key);
      if (!remote || remote.size !== sample.length || (remote.sha256 && remote.sha256 !== sha)) throw new Error("Probe metadata mismatch");
      await provider.downloadTo(key, target, sample.length);
      if (!(await readFile(target)).equals(sample)) throw new Error("Probe checksum mismatch");
    } catch {
      failed = true;
    } finally {
      await provider.delete(key).catch(() => { failed = true; });
      await rm(source, { force: true });
      await rm(target, { force: true });
      await rmdir(dir);
    }
    if (this.location()?.id === location.id) recordStorageHealth(this.db, [], new Date(), failed ? "failed" : "passed");
    return { ok: !failed, latencyMs: Date.now() - started, ...(failed ? { error: "Không kiểm tra được ghi, đọc hoặc xóa ở kho S3." } : {}) };
  }
}
