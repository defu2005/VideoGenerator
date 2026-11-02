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
});

export type AppConfig = {
  PORT: number;
  HOST: string;
  DATA_DIR: string;
  DATABASE_PATH: string;
  LOG_LEVEL: z.infer<typeof ConfigSchema>["LOG_LEVEL"];
  CORS_ORIGIN: string;
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
