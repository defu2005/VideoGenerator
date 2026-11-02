import { existsSync, readFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

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

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default("127.0.0.1"),
  DATA_DIR: z.string().min(1).default("./data"),
  DATABASE_PATH: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  WORKER_ENABLED: z.stringbool().default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(1),
  STAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
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
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-5-5"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434/v1"),
  OLLAMA_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  CUSTOM_LLM_BASE_URL: z.string().optional(),
  CUSTOM_LLM_API_KEY: z.string().optional(),
  CUSTOM_LLM_MODEL: z.string().optional(),
  LLM_PRICES_JSON: z.string().optional(),
  SPEECH_WORDS_PER_MINUTE: z.coerce.number().positive().default(150),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(3),
  JOB_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(2_000),
  FAKE_STAGE_DELAY_MS: z.coerce.number().int().nonnegative().default(300),
});

export type AppConfig = {
  PORT: number;
  HOST: string;
  DATA_DIR: string;
  DATABASE_PATH: string;
  LOG_LEVEL: z.infer<typeof ConfigSchema>["LOG_LEVEL"];
  CORS_ORIGIN: string;
  WORKER_ENABLED: boolean;
  WORKER_CONCURRENCY: number;
  STAGE_TIMEOUT_MS: number;
  LLM_TIMEOUT_MS: number;
  LLM_CACHE_ENABLED: boolean;
  LLM_ENABLE_MOCK: boolean;
  LLM_DEFAULT_PROVIDER?: string;
  LLM_DEFAULT_MODEL?: string;
  LLM_RESEARCH_PROVIDER?: string;
  LLM_RESEARCH_MODEL?: string;
  LLM_RESEARCH_MODE: "merged" | "separate" | "off";
  LLM_SCRIPT_PROVIDER?: string;
  LLM_SCRIPT_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  CUSTOM_LLM_BASE_URL?: string;
  CUSTOM_LLM_API_KEY?: string;
  CUSTOM_LLM_MODEL?: string;
  LLM_PRICES_JSON?: string;
  SPEECH_WORDS_PER_MINUTE: number;
  JOB_MAX_ATTEMPTS: number;
  JOB_RETRY_BASE_MS: number;
  FAKE_STAGE_DELAY_MS: number;
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
  const isProduction = env.NODE_ENV === "production";
  const dataDirectory = isAbsolute(values.DATA_DIR)
    ? values.DATA_DIR
    : resolve(workspaceRoot, values.DATA_DIR);
  return {
    ...values,
    DATA_DIR: dataDirectory,
    LLM_ENABLE_MOCK: values.LLM_ENABLE_MOCK ?? !isProduction,
    DATABASE_PATH: values.DATABASE_PATH
      ? isAbsolute(values.DATABASE_PATH) ? values.DATABASE_PATH : resolve(workspaceRoot, values.DATABASE_PATH)
      : join(dataDirectory, "app.db"),
  };
}
