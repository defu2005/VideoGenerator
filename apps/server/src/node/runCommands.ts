import { setTimeout as delay } from "node:timers/promises";
import type Database from "better-sqlite3";
import { PipelineStageSchema, STAGE_ORDER } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { NodeRow } from "./nodeService.js";
import type { ProjectRunService } from "./runService.js";

export const RunCommandPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cancel") }).strict(),
  z.object({ kind: z.literal("pause") }).strict(),
  z.object({ kind: z.literal("rebase") }).strict(),
  z.object({ kind: z.literal("budget"), capUsd: z.number().finite().nonnegative() }).strict(),
  z.object({ kind: z.literal("stopBefore"), stages: z.array(PipelineStageSchema).max(STAGE_ORDER.length) }).strict(),
]);
export type RunCommandPayload = z.infer<typeof RunCommandPayloadSchema>;
export type RunCommand = RunCommandPayload & { sequence: number };

/** A run has one control writer and one leased reader. Store commands with the run
 * so a worker reconnecting to a restarted server still sees unacknowledged changes. */
export class RunCommands {
  constructor(private readonly db: Database.Database, private readonly runs: ProjectRunService, private readonly now = () => new Date()) {}

  private key(runId: string) { return `execution.commands.${runId}`; }

  private read(runId: string): RunCommand[] {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key=?").get(this.key(runId)) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as RunCommand[] : [];
  }

  enqueue(runId: string, payload: RunCommandPayload): RunCommand {
    const value = RunCommandPayloadSchema.parse(payload);
    return this.db.transaction(() => {
      const run = this.runs.get(runId);
      if (!run || !["GRANTED", "RUNNING"].includes(run.status) || run.leaseUntil <= this.now().toISOString()) {
        throw new AppError(409, "LEASE_STALE", "Đoạn chạy không còn hiệu lực.");
      }
      const commands = this.read(runId);
      const command: RunCommand = { ...value, sequence: (commands.at(-1)?.sequence ?? 0) + 1 };
      commands.push(command);
      const at = this.now().toISOString();
      this.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .run(this.key(runId), JSON.stringify(commands), at);
      if (value.kind === "budget") this.db.prepare("UPDATE project_runs SET budget_cap_usd=? WHERE id=?").run(value.capUsd, runId);
      if (value.kind === "stopBefore") this.db.prepare("UPDATE project_runs SET stop_before=? WHERE id=?").run(JSON.stringify(value.stages), runId);
      return command;
    }).immediate();
  }

  async poll(node: Pick<NodeRow, "id">, runId: string, leaseId: string, after: number, signal: AbortSignal, waitMs = 25_000): Promise<RunCommand[]> {
    const deadline = Date.now() + waitMs;
    while (!signal.aborted) {
      this.runs.holding(node, runId, leaseId);
      const commands = this.read(runId).filter((command) => command.sequence > after);
      const left = deadline - Date.now();
      if (commands.length || left <= 0) return commands;
      await delay(Math.min(500, left), undefined, { signal }).catch((error: unknown) => { if (!signal.aborted) throw error; });
    }
    return [];
  }
}
