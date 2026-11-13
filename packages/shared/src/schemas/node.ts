import { z } from "zod";
import { ArtifactRefSchema, RenderBundleSchema } from "./renderBundle.js";

export const NodeStatusSchema = z.enum(["online", "offline", "draining", "revoked", "version_mismatch"]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

/** `render`, `media_fetch`, or `tts:<provider id>` (for example `tts:piper`, `tts:vieneu`, `tts:google`). */
export const NodeCapabilitySchema = z.string().regex(/^(render|media_fetch|tts:[a-z0-9][a-z0-9_-]{1,29})$/);
export type NodeCapability = z.infer<typeof NodeCapabilitySchema>;
/** Capability -> tool version (for example `tts:piper` -> `1.2.0`). Informational: shown on the Nodes page. */
export const NodeCapabilityInfoSchema = z.record(z.string().max(40), z.string().max(60));
export type NodeCapabilityInfo = z.infer<typeof NodeCapabilityInfoSchema>;

/** The stages a node may run. RENDER is the original; VOICE and MEDIA_FETCH arrive with TASK-120. */
export const REMOTE_STAGES = ["RENDER", "VOICE", "MEDIA_FETCH"] as const;
export type RemoteStage = (typeof REMOTE_STAGES)[number];
export const RemoteStageSchema = z.enum(REMOTE_STAGES);

export const NodeResourcesSchema = z.object({
  cpus: z.number().int().nonnegative(),
  ramMb: z.number().int().nonnegative(),
  freeDiskMb: z.number().int().nonnegative(),
}).strict();

export const NodeDesiredConfigSchema = z.object({
  concurrency: z.number().int().min(1).max(8),
  drain: z.boolean(),
  capabilities: z.array(NodeCapabilitySchema),
}).strict();
export type NodeDesiredConfig = z.infer<typeof NodeDesiredConfigSchema>;
export const DEFAULT_NODE_CONFIG: NodeDesiredConfig = { concurrency: 1, drain: false, capabilities: ["render"] };

/** The capability a node must hold to take a stage's job. TTS needs the capability of the provider the plan picked. */
export function capabilityForStage(stage: RemoteStage, ttsProvider?: string): string {
  if (stage === "RENDER") return "render";
  if (stage === "MEDIA_FETCH") return "media_fetch";
  return `tts:${ttsProvider ?? "mock"}`;
}

export const NodeProbeSchema = z.object({
  render: z.object({
    ok: z.boolean(),
    reason: z.string().max(300).optional(),
    checkedAt: z.string().max(40),
    ms: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();
export type NodeProbe = z.infer<typeof NodeProbeSchema>;

export const NodePatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
  drain: z.boolean().optional(),
  capabilities: z.array(NodeCapabilitySchema).optional(),
}).strict();

export const NodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: NodeStatusSchema,
  version: z.string().nullable(),
  capabilities: z.array(NodeCapabilitySchema),
  capabilityInfo: NodeCapabilityInfoSchema.default({}),
  resources: NodeResourcesSchema.nullable(),
  desiredConfig: NodeDesiredConfigSchema,
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  runningJobs: z.number().int().nonnegative(),
  probe: NodeProbeSchema.nullable().default(null),
});
export type VideoNode = z.infer<typeof NodeSchema>;

export const JoinRequestSchema = z.object({
  joinToken: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(80),
  version: z.string().max(40),
  capabilities: z.array(NodeCapabilitySchema).max(24),
  capabilityInfo: NodeCapabilityInfoSchema.optional(),
  resources: NodeResourcesSchema,
  probe: NodeProbeSchema.optional(),
}).strict();
export const JoinResponseSchema = z.object({
  nodeId: z.string(),
  nodeToken: z.string(),
  desiredConfig: NodeDesiredConfigSchema,
}).strict();

export const HeartbeatRequestSchema = z.object({
  version: z.string().max(40),
  capabilities: z.array(NodeCapabilitySchema).max(24),
  capabilityInfo: NodeCapabilityInfoSchema.optional(),
  resources: NodeResourcesSchema,
  probe: NodeProbeSchema.optional(),
  running: z.array(z.object({
    jobId: z.string(),
    leaseId: z.string(),
    progress: z.number().min(0).max(100),
    message: z.string().max(300).optional(),
  }).strict()).max(16),
}).strict();
export const HeartbeatResponseSchema = z.object({
  desiredConfig: NodeDesiredConfigSchema,
  targetVersion: z.string().nullable(),
  cancel: z.array(z.string()),
}).strict();

/** `publicKey`: the node's X25519 public key (base64 DER), fresh per request and kept in memory, so a lease secret can be sealed for it. */
export const LeaseRequestSchema = z.object({
  freeSlots: z.number().int().min(0).max(8),
  publicKey: z.string().min(40).max(200).optional(),
}).strict();

/** A node that lost its key (process restart mid-job) asks for it again. Same lease, same expiry. */
export const SecretRequestSchema = z.object({
  leaseId: z.string().min(1).max(100),
  publicKey: z.string().min(40).max(200),
}).strict();

export const TtsBundleSchema = z.object({
  kind: z.literal("tts"),
  provider: z.string().min(2).max(30),
  voice: z.string().max(200),
  rate: z.string().max(20),
  model: z.string().max(100).optional(),
  style: z.string().max(100).optional(),
  language: z.string().max(20),
  /** What the provider gives: real word timings, or the aligner/estimate fills them in. */
  timingMode: z.enum(["provider", "aligned", "estimated"]),
  scenes: z.array(z.object({
    sceneId: z.string(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    text: z.string().min(1).max(20_000),
  }).strict()).min(1).max(500),
}).strict();
export type TtsBundle = z.infer<typeof TtsBundleSchema>;

export const MediaBundleSchema = z.object({
  kind: z.literal("media"),
  targetShortSide: z.number().int().min(100).max(4320),
  maxBytes: z.number().int().positive(),
  items: z.array(z.object({
    provider: z.enum(["pexels", "pixabay"]),
    clipId: z.string().max(80),
    /** Public file URL. The licence record travels with it so the control plane keeps the credit lines. */
    url: z.string().url().max(2000),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    durationSec: z.number().nonnegative(),
    bytes: z.number().int().nonnegative().optional(),
    /** Name the node must upload under: `media/<provider>-<id>-<height>.mp4`. */
    target: z.string().regex(/^media\/[a-z]+-[a-zA-Z0-9_-]+-\d+\.mp4$/),
    licence: z.object({
      name: z.string().max(200),
      author: z.string().max(200),
      pageUrl: z.string().max(2000),
    }).strict(),
  }).strict()).min(1).max(40),
}).strict();
export type MediaBundle = z.infer<typeof MediaBundleSchema>;

/** A lease secret sealed for one node: X25519 + HKDF-SHA256 + AES-256-GCM. The plain key never appears in this object. */
export const SealedSecretSchema = z.object({
  /** Which kind of key: `tts:google`. Only TTS keys can ever be sent. */
  scope: z.string().regex(/^tts:[a-z0-9_-]{2,30}$/),
  label: z.string().max(80),
  expiresAt: z.string(),
  ephemeralPublicKey: z.string(),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
}).strict();
export type SealedSecret = z.infer<typeof SealedSecretSchema>;

export const LeaseResponseSchema = z.object({
  jobId: z.string(),
  leaseId: z.string(),
  leaseUntil: z.string(),
  stage: RemoteStageSchema.default("RENDER"),
  bundle: z.union([RenderBundleSchema, TtsBundleSchema, MediaBundleSchema]),
  manifest: z.array(ArtifactRefSchema),
  secret: SealedSecretSchema.optional(),
}).strict();
export type LeaseResponse = z.infer<typeof LeaseResponseSchema>;

export const CompleteRequestSchema = z.object({
  leaseId: z.string(),
  outputs: z.array(z.object({ name: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).max(500),
}).strict();
export const FailRequestSchema = z.object({
  leaseId: z.string(),
  code: z.string().max(60),
  message: z.string().max(500),
  retryable: z.boolean(),
}).strict();

export const REMOTE_RENDER_MODES = ["off", "prefer", "only"] as const;
export const RemoteRenderSettingsSchema = z.object({
  mode: z.enum(REMOTE_RENDER_MODES),
  remoteWaitSec: z.number().int().min(5).max(600),
}).strict();
export type RemoteRenderSettings = z.infer<typeof RemoteRenderSettingsSchema>;
/** "control" = nodes follow the control plane's version. The bundle format is tied to that version, so no other value is accepted. */
export const NodeTargetVersionSchema = z.literal("control");
export const NodeSettingsSchema = RemoteRenderSettingsSchema.extend({
  nodeTargetVersion: NodeTargetVersionSchema.default("control"),
}).strict();
export type NodeSettings = z.infer<typeof NodeSettingsSchema>;

export const DEFAULT_REMOTE_RENDER: RemoteRenderSettings = { mode: "off", remoteWaitSec: 30 };

/** Placement of the stages added by TASK-120. RENDER keeps its own `mode` above so today's behaviour cannot change. */
export const RemoteStagesSettingsSchema = z.object({
  VOICE: z.enum(REMOTE_RENDER_MODES),
  MEDIA_FETCH: z.enum(REMOTE_RENDER_MODES),
}).strict();
export type RemoteStagesSettings = z.infer<typeof RemoteStagesSettingsSchema>;
export const DEFAULT_REMOTE_STAGES: RemoteStagesSettings = { VOICE: "off", MEDIA_FETCH: "off" };

/** What `GET /api/nodes` shows: the render wait plus a mode for every remote stage and the keys kept local. */
export const NodePlacementSettingsSchema = z.object({
  mode: z.enum(REMOTE_RENDER_MODES),
  remoteWaitSec: z.number().int().min(5).max(600),
  stages: z.object({
    RENDER: z.enum(REMOTE_RENDER_MODES),
    VOICE: z.enum(REMOTE_RENDER_MODES),
    MEDIA_FETCH: z.enum(REMOTE_RENDER_MODES),
  }).strict(),
  /** Keys the user marked "không gửi ra node". Names only, for example `tts.google.apiKey`. */
  localOnlyKeys: z.array(z.string().max(120)).max(100),
}).strict();
export type NodePlacementSettings = z.infer<typeof NodePlacementSettingsSchema>;

export const NodePlacementUpdateSchema = z.object({
  mode: z.enum(REMOTE_RENDER_MODES).optional(),
  remoteWaitSec: z.number().int().min(5).max(600).optional(),
  stages: RemoteStagesSettingsSchema.partial().optional(),
  localOnlyKeys: z.array(z.string().max(120)).max(100).optional(),
}).strict();

export const NodeSecretGrantSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  jobId: z.string(),
  stage: z.string(),
  scope: z.string(),
  label: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
  /** Vietnamese line the page shows, built on the server so the page and the assistant say the same. */
  summary: z.string(),
});
export type NodeSecretGrant = z.infer<typeof NodeSecretGrantSchema>;

export const NodeJobSummarySchema = z.object({
  jobId: z.string(),
  projectId: z.string().nullable(),
  stage: z.string(),
  status: z.string(),
  progress: z.number(),
  message: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  errorCode: z.string().nullable(),
});
export type NodeJobSummary = z.infer<typeof NodeJobSummarySchema>;

export const NodeDetailSchema = z.object({
  node: NodeSchema,
  running: z.array(NodeJobSummarySchema),
  recent: z.array(NodeJobSummarySchema),
  failures24h: z.number().int().nonnegative(),
});
export type NodeDetail = z.infer<typeof NodeDetailSchema>;

/** Commands that put a machine on the control plane's version. Pure so the page and tests share them. */
export function buildJoinCommands(input: { controlUrl: string; token: string; image: string; version: string }): { docker: string; source: string } {
  const url = input.controlUrl.trim().replace(/\/+$/, "");
  const docker = [
    "docker run -d --name vg-worker --restart on-failure --init --shm-size 1gb \\",
    "  -e VG_ROLE=worker -e DATA_DIR=/data \\",
    `  -e VG_CONTROL_URL=${url} \\`,
    `  -e VG_JOIN_TOKEN=${input.token} \\`,
    "  -e VG_EXIT_FOR_UPDATE=1 \\",
    "  -v vg-worker-data:/data \\",
    `  ${input.image}:${input.version}`,
  ].join("\n");
  const source = [
    "git pull && npm ci && npm run build",
    `VG_ROLE=worker VG_CONTROL_URL=${url} VG_JOIN_TOKEN=${input.token} npm run start -w @vg/server`,
  ].join("\n");
  return { docker, source };
}

export function buildUpdateCommands(input: { image: string; version: string }): { docker: string; source: string } {
  return {
    docker: `docker compose -f compose.worker.yml pull && docker compose -f compose.worker.yml up -d\n# hoặc: docker pull ${input.image}:${input.version}`,
    source: "git pull && npm ci && npm run build",
  };
}

export function isLoopbackControlUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}
