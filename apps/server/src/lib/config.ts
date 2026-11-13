import os from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST, LLM_TASKS, type LlmProviderId, type LlmTaskId, type LlmRoute } from "@vg/shared";
import type { LlmProviderLimits } from "../providers/llm/types.js";

function findWorkspaceRoot(startDirectory: string): string | undefined {
  let directory = resolve(startDirectory);
  while (true) {
    const packagePath = join(directory, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { workspaces?: unknown };
      if (packageJson.workspaces !== undefined) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(process.cwd()) ?? process.cwd();
loadDotenv({ path: join(workspaceRoot, ".env") });

function resolveEdgeTtsPath(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.EDGE_TTS_PATH || env.EDGE_TTS_BIN || env.EDGE_TTS_EXECUTABLE;
  if (direct) return direct;
  const candidates: string[] = [];
  const pathEntries = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) candidates.push(join(entry, "edge-tts"), join(entry, "edge-tts.exe"));
  if (process.platform === "win32") {
    for (const [root, versions] of [
      [env.APPDATA, /^Python3/i],
      [env.LOCALAPPDATA, /^Python/i],
    ] as const) {
      if (!root) continue;
      const pythonRoot = join(root, "Python");
      if (!existsSync(pythonRoot)) continue;
      for (const version of readdirSync(pythonRoot)) {
        if (versions.test(version)) candidates.push(join(pythonRoot, version, "Scripts", "edge-tts.exe"));
      }
    }
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "edge-tts";
}

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default("127.0.0.1"),
  DATA_DIR: z.string().min(1).default("./data"),
  VG_ENVIRONMENT: z.string().trim().min(1).max(64).default("default"),
  DATABASE_PATH: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  /** Public web UI base URL for links in notifications (Telegram, etc.). */
  WEB_BASE_URL: z.string().url().default("http://localhost:5180"),
  WORKER_ENABLED: z.stringbool().default(true),
  // TASK-129b: upper bound for the resource governor; default is cpu count x 2, capped at 32.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(Math.min(32, Math.max(1, os.cpus().length * 2))),
  RENDER_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  STAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  NODE_LEASE_SEC: z.coerce.number().int().min(10).max(600).default(60),
  NODE_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(4096),
  NODE_SHUTDOWN_GRACE_SEC: z.coerce.number().int().min(0).max(3600).default(120),
  NODE_CACHE_MAX_GB: z.coerce.number().positive().default(20),
  VG_CONTROL_URL: z.string().optional(),
  VG_JOIN_TOKEN: z.string().optional(),
  VG_NODE_NAME: z.string().optional(),
  VG_ALLOW_INSECURE_CONTROL: z.stringbool().default(false),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  LLM_CACHE_ENABLED: z.stringbool().default(true),
  LLM_ENABLE_MOCK: z.stringbool().optional(),
  LLM_DEFAULT_PROVIDER: z.string().optional(),
  LLM_DEFAULT_MODEL: z.string().optional(),
  LLM_RESEARCH_PROVIDER: z.string().optional(),
  LLM_RESEARCH_MODEL: z.string().optional(),
  LLM_RESEARCH_MODE: z.enum(["merged", "separate", "off"]).default("merged"),
  LLM_SCRIPT_PROVIDER: z.string().optional(),
  LLM_SCRIPT_MODEL: z.string().optional(),
  LLM_SCRIPT_REVIEW_PROVIDER: z.string().optional(),
  LLM_SCRIPT_REVIEW_MODEL: z.string().optional(),
  LLM_SCENE_QUERIES_PROVIDER: z.string().optional(),
  LLM_SCENE_QUERIES_MODEL: z.string().optional(),
  LLM_VISUAL_ALT_QUERIES_PROVIDER: z.string().optional(),
  LLM_VISUAL_ALT_QUERIES_MODEL: z.string().optional(),
  LLM_VISUAL_RERANK_PROVIDER: z.string().optional(),
  LLM_VISUAL_RERANK_MODEL: z.string().optional(),
  LLM_VISION_CHECK_PROVIDER: z.string().optional(),
  LLM_VISION_CHECK_MODEL: z.string().optional(),
  LLM_MUSIC_ASSIST_PROVIDER: z.string().optional(),
  LLM_MUSIC_ASSIST_MODEL: z.string().optional(),
  LLM_METADATA_PROVIDER: z.string().optional(),
  LLM_METADATA_MODEL: z.string().optional(),
  CLAUDE_CLI_ENABLED: z.stringbool().default(false),
  CLAUDE_CLI_PATH: z.string().min(1).default("claude"),
  CLAUDE_CLI_MODEL: z.string().optional(),
  COPILOT_CLI_ENABLED: z.stringbool().default(false),
  COPILOT_CLI_PATH: z.string().min(1).default("copilot"),
  COPILOT_CLI_MODEL: z.string().optional(),
  ANTIGRAVITY_CLI_ENABLED: z.stringbool().default(false),
  ANTIGRAVITY_CLI_PATH: z.string().optional(),
  ANTIGRAVITY_CLI_MODEL: z.string().optional(),
  ANTIGRAVITY_CLI_EFFORT: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-5-5"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434/v1"),
  OLLAMA_MODEL: z.string().optional(),
  REMOTE_OLLAMA_BASE_URL: z.string().optional(),
  REMOTE_OLLAMA_TOKEN: z.string().optional(),
  REMOTE_OLLAMA_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  OMNIROUTE_BASE_URL: z.string().optional(),
  OMNIROUTE_API_KEY: z.string().optional(),
  OMNIROUTE_MODEL: z.string().optional(),
  OPENCODE_API_KEY: z.string().optional(),
  OPENCODE_BASE_URL: z.string().default("https://opencode.ai/zen/v1"),
  OPENCODE_MODEL: z.string().optional(),
  CUSTOM_LLM_BASE_URL: z.string().optional(),
  CUSTOM_LLM_API_KEY: z.string().optional(),
  CUSTOM_LLM_MODEL: z.string().optional(),
  LLM_PRICES_JSON: z.string().optional(),
  USD_VND_RATE: z.coerce.number().positive().default(26000),
  SPEECH_WORDS_PER_MINUTE: z.coerce.number().positive().default(150),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(3),
  JOB_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(2_000),
  FAKE_STAGE_DELAY_MS: z.coerce.number().int().nonnegative().default(300),
  TTS_PROVIDER: z.enum(["edge-tts", "mock", "google_cloud", "gemini", "elevenlabs", "openai", "fpt_ai", "viettel_ai", "piper", "vieneu"]).default("edge-tts"),
  EDGE_TTS_PATH: z.string().min(1).default(resolveEdgeTtsPath()),
  TTS_VOICE_VI: z.string().min(1).default("vi-VN-HoaiMyNeural"),
  TTS_VOICE_EN: z.string().min(1).default("en-US-AriaNeural"),
  TTS_RATE: z.string().regex(/^[+-]\d{1,3}%$/).default("+0%"),
  TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  IMAGE_PROVIDERS: z.string().default(
    "wikimedia,openverse,pexels,pixabay,unsplash,nasa,met,loc,smithsonian,europeana,flickr",
  ),
  IMAGE_SEARCH_USER_AGENT: z.string().min(1).default("VideoAgent/0.1 (https://github.com/defu2005/videoGenerator)"),
  IMAGE_DOWNLOAD_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1_000),
  IMAGE_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  IMAGE_SEARCH_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  IMAGE_SEARCH_PER_MINUTE_WIKIMEDIA: z.coerce.number().int().positive().default(60),
  IMAGE_SEARCH_PER_MINUTE_OPENVERSE: z.coerce.number().int().positive().default(20),
  IMAGE_SEARCH_PER_MINUTE_PEXELS: z.coerce.number().int().positive().default(180),
  IMAGE_SEARCH_PER_MINUTE_PIXABAY: z.coerce.number().int().positive().default(100),
  IMAGE_SEARCH_PER_MINUTE_UNSPLASH: z.coerce.number().int().positive().default(50),
  IMAGE_SEARCH_PER_MINUTE_NASA: z.coerce.number().int().positive().default(60),
  IMAGE_SEARCH_PER_MINUTE_MET: z.coerce.number().int().positive().default(40),
  IMAGE_SEARCH_PER_MINUTE_LOC: z.coerce.number().int().positive().default(40),
  IMAGE_SEARCH_PER_MINUTE_SMITHSONIAN: z.coerce.number().int().positive().default(60),
  IMAGE_SEARCH_PER_MINUTE_EUROPEANA: z.coerce.number().int().positive().default(60),
  IMAGE_SEARCH_PER_MINUTE_FLICKR: z.coerce.number().int().positive().default(60),
  OPENVERSE_CLIENT_ID: z.string().trim().min(1).optional(),
  OPENVERSE_CLIENT_SECRET: z.string().trim().min(1).optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  SMITHSONIAN_API_KEY: z.string().optional(),
  EUROPEANA_API_KEY: z.string().optional(),
  FLICKR_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  WEB_IMAGE_GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  WEB_IMAGE_SEARCH_PER_MINUTE: z.coerce.number().int().positive().default(30),
  WEB_IMAGE_DOMAIN_DENYLIST: z.string().default(DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST.join(",")),
  MUSIC_PROVIDERS: z.string().default("openverse,local"),
  MUSIC_LIBRARY_DIR: z.string().optional(),
  MUSIC_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Base64-encoded 32-byte AES key for the token vault. If unset, a key file is created under DATA_DIR/secrets/. */
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  /** Better Auth secret. When unset, a key file is created under DATA_DIR/secrets/. Never log this. */
  BETTER_AUTH_SECRET: z.string().optional(),
  /** Extra browser origins, comma-separated. Local web origins are always included. */
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  /** OAuth app credentials — fallback when the account vault has none (real publishers in later tasks). */
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  /** App-level daily YouTube Data API quota budget (units). Resets at midnight Pacific Time. */
  YOUTUBE_DAILY_QUOTA: z.coerce.number().int().positive().default(10_000),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
}).superRefine((values, context) => {
  if (Boolean(values.OPENVERSE_CLIENT_ID) !== Boolean(values.OPENVERSE_CLIENT_SECRET)) {
    context.addIssue({
      code: "custom",
      path: ["OPENVERSE_CLIENT_ID"],
      message: "OPENVERSE_CLIENT_ID and OPENVERSE_CLIENT_SECRET must be set together",
    });
  }
});

export type AppConfig = {
  PORT: number;
  HOST: string;
  DATA_DIR: string;
  VG_ENVIRONMENT: string;
  DATABASE_PATH: string;
  LOG_LEVEL: z.infer<typeof ConfigSchema>["LOG_LEVEL"];
  CORS_ORIGIN: string;
  WEB_BASE_URL: string;
  WORKER_ENABLED: boolean;
  WORKER_CONCURRENCY: number;
  RENDER_CONCURRENCY: number;
  STAGE_TIMEOUT_MS: number;
  NODE_LEASE_SEC: number;
  NODE_MAX_UPLOAD_MB: number;
  NODE_SHUTDOWN_GRACE_SEC: number;
  NODE_CACHE_MAX_GB: number;
  VG_CONTROL_URL?: string;
  VG_JOIN_TOKEN?: string;
  VG_NODE_NAME?: string;
  VG_ALLOW_INSECURE_CONTROL: boolean;
  LLM_TIMEOUT_MS: number;
  LLM_CACHE_ENABLED: boolean;
  LLM_ENABLE_MOCK: boolean;
  LLM_PROVIDER_LIMITS: Partial<Record<LlmProviderId, LlmProviderLimits>>;
  LLM_DEFAULT_PROVIDER?: string;
  LLM_DEFAULT_MODEL?: string;
  LLM_RESEARCH_PROVIDER?: string;
  LLM_RESEARCH_MODEL?: string;
  LLM_RESEARCH_MODE: "merged" | "separate" | "off";
  LLM_SCRIPT_PROVIDER?: string;
  LLM_SCRIPT_MODEL?: string;
  LLM_TASK_ROUTES: Partial<Record<LlmTaskId, LlmRoute>>;
  CLAUDE_CLI_ENABLED: boolean;
  CLAUDE_CLI_PATH: string;
  CLAUDE_CLI_MODEL?: string;
  COPILOT_CLI_ENABLED: boolean;
  COPILOT_CLI_PATH: string;
  COPILOT_CLI_MODEL?: string;
  ANTIGRAVITY_CLI_ENABLED: boolean;
  ANTIGRAVITY_CLI_PATH?: string;
  ANTIGRAVITY_CLI_MODEL?: string;
  ANTIGRAVITY_CLI_EFFORT: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  REMOTE_OLLAMA_BASE_URL?: string;
  REMOTE_OLLAMA_TOKEN?: string;
  REMOTE_OLLAMA_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  OMNIROUTE_BASE_URL?: string;
  OMNIROUTE_API_KEY?: string;
  OMNIROUTE_MODEL?: string;
  OPENCODE_API_KEY?: string;
  OPENCODE_BASE_URL: string;
  OPENCODE_MODEL?: string;
  CUSTOM_LLM_BASE_URL?: string;
  CUSTOM_LLM_API_KEY?: string;
  CUSTOM_LLM_MODEL?: string;
  LLM_PRICES_JSON?: string;
  USD_VND_RATE: number;
  SPEECH_WORDS_PER_MINUTE: number;
  JOB_MAX_ATTEMPTS: number;
  JOB_RETRY_BASE_MS: number;
  FAKE_STAGE_DELAY_MS: number;
  TTS_PROVIDER: "edge-tts" | "mock" | "google_cloud" | "gemini" | "elevenlabs" | "openai" | "fpt_ai" | "viettel_ai" | "piper" | "vieneu";
  EDGE_TTS_PATH: string;
  TTS_VOICE_VI: string;
  TTS_VOICE_EN: string;
  TTS_RATE: string;
  TTS_TIMEOUT_MS: number;
  IMAGE_PROVIDERS: string;
  IMAGE_SEARCH_USER_AGENT: string;
  IMAGE_DOWNLOAD_MIN_INTERVAL_MS: number;
  IMAGE_SEARCH_TIMEOUT_MS: number;
  IMAGE_SEARCH_CACHE_TTL_HOURS: number;
  IMAGE_SEARCH_PER_MINUTE_WIKIMEDIA: number;
  IMAGE_SEARCH_PER_MINUTE_OPENVERSE: number;
  IMAGE_SEARCH_PER_MINUTE_PEXELS: number;
  IMAGE_SEARCH_PER_MINUTE_PIXABAY: number;
  IMAGE_SEARCH_PER_MINUTE_UNSPLASH: number;
  IMAGE_SEARCH_PER_MINUTE_NASA: number;
  IMAGE_SEARCH_PER_MINUTE_MET: number;
  IMAGE_SEARCH_PER_MINUTE_LOC: number;
  IMAGE_SEARCH_PER_MINUTE_SMITHSONIAN: number;
  IMAGE_SEARCH_PER_MINUTE_EUROPEANA: number;
  IMAGE_SEARCH_PER_MINUTE_FLICKR: number;
  OPENVERSE_CLIENT_ID?: string;
  OPENVERSE_CLIENT_SECRET?: string;
  PEXELS_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  UNSPLASH_ACCESS_KEY?: string;
  SMITHSONIAN_API_KEY?: string;
  EUROPEANA_API_KEY?: string;
  FLICKR_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;
  WEB_IMAGE_GEMINI_MODEL: string;
  WEB_IMAGE_SEARCH_PER_MINUTE: number;
  WEB_IMAGE_DOMAIN_DENYLIST: string;
  MUSIC_PROVIDERS: string;
  MUSIC_LIBRARY_DIR: string;
  MUSIC_SEARCH_TIMEOUT_MS: number;
  TOKEN_ENCRYPTION_KEY?: string;
  BETTER_AUTH_SECRET?: string;
  AUTH_TRUSTED_ORIGINS?: string;
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  YOUTUBE_DAILY_QUOTA: number;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
};

const providerLimitPrefixes: Partial<Record<LlmProviderId, string>> = {
  anthropic: "ANTHROPIC",
  gemini: "GEMINI",
  openai: "OPENAI",
  ollama: "OLLAMA",
  "remote-ollama": "REMOTE_OLLAMA",
  openrouter: "OPENROUTER",
  deepseek: "DEEPSEEK",
  groq: "GROQ",
  omniroute: "OMNIROUTE",
  opencode: "OPENCODE",
  custom: "CUSTOM_LLM",
  mock: "MOCK",
  "claude-cli": "CLAUDE_CLI",
  "copilot-cli": "COPILOT_CLI",
  "antigravity-cli": "ANTIGRAVITY_CLI",
};

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }

  const values = parsed.data;
  const providerLimits = parseProviderLimits(env);
  const isProduction = env.NODE_ENV === "production";
  const dataDirectory = isAbsolute(values.DATA_DIR)
    ? values.DATA_DIR
    : resolve(workspaceRoot, values.DATA_DIR);
  return {
    ...values,
    IMAGE_SEARCH_PER_MINUTE_OPENVERSE: env.IMAGE_SEARCH_PER_MINUTE_OPENVERSE
      ? values.IMAGE_SEARCH_PER_MINUTE_OPENVERSE
      : values.OPENVERSE_CLIENT_ID ? 100 : values.IMAGE_SEARCH_PER_MINUTE_OPENVERSE,
    LLM_PROVIDER_LIMITS: providerLimits,
    LLM_TASK_ROUTES: Object.fromEntries(LLM_TASKS.flatMap(({ id }) => {
      const envTask = id.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
      const prefix = `LLM_${envTask}`;
      const provider = env[`${prefix}_PROVIDER`]?.trim()
        || (id === "research" ? values.LLM_RESEARCH_PROVIDER : id === "script" || id === "scriptReview" ? values.LLM_SCRIPT_PROVIDER : undefined)
        || (env[`${prefix}_MODEL`]?.trim() ? values.LLM_DEFAULT_PROVIDER : undefined);
      const model = env[`${prefix}_MODEL`]?.trim()
        || (id === "research" ? values.LLM_RESEARCH_MODEL : id === "script" || id === "scriptReview" ? values.LLM_SCRIPT_MODEL : undefined);
      return provider ? [[id, { provider, ...(model ? { model } : {}) }]] : [];
    })) as Partial<Record<LlmTaskId, LlmRoute>>,
    DATA_DIR: dataDirectory,
    MUSIC_LIBRARY_DIR: values.MUSIC_LIBRARY_DIR
      ? isAbsolute(values.MUSIC_LIBRARY_DIR) ? values.MUSIC_LIBRARY_DIR : resolve(workspaceRoot, values.MUSIC_LIBRARY_DIR)
      : join(dataDirectory, "music"),
    LLM_ENABLE_MOCK: values.LLM_ENABLE_MOCK ?? !isProduction,
    DATABASE_PATH: values.DATABASE_PATH
      ? isAbsolute(values.DATABASE_PATH) ? values.DATABASE_PATH : resolve(workspaceRoot, values.DATABASE_PATH)
      : join(dataDirectory, "app.db"),
  };
}

function parseProviderLimits(
  env: NodeJS.ProcessEnv,
): Partial<Record<LlmProviderId, LlmProviderLimits>> {
  const limits: Partial<Record<LlmProviderId, LlmProviderLimits>> = {};
  for (const [provider, prefix] of Object.entries(providerLimitPrefixes) as [LlmProviderId, string][]) {
    const maxInputTokens = parseOptionalTokenLimit(env, `${prefix}_MAX_INPUT_TOKENS`);
    const maxOutputTokens = parseOptionalTokenLimit(env, `${prefix}_MAX_OUTPUT_TOKENS`);
    if (maxInputTokens !== undefined || maxOutputTokens !== undefined) {
      limits[provider] = {
        ...(maxInputTokens === undefined ? {} : { maxInputTokens }),
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      };
    }
  }
  return limits;
}

function parseOptionalTokenLimit(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  const parsed = z.coerce.number().int().positive().safeParse(value);
  if (!parsed.success) throw new Error(`Invalid server configuration: ${name}: expected a positive integer`);
  return parsed.data;
}
