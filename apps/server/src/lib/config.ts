import "dotenv/config";
import { join } from "node:path";
import { z } from "zod";

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
  return {
    ...values,
    DATABASE_PATH: values.DATABASE_PATH ?? join(values.DATA_DIR, "app.db"),
  };
}
