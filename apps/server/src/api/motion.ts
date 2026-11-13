import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { MOTION_TEMPLATES, motionTelemetryEnv } from "@vg/shared";
import { hyperframesEntry, inlineMotionPreview, killProcessTree, renderMotionGraphic } from "../media/motion.js";

export function registerMotionRoutes(app: FastifyInstance, options: { dataDir: string }): void {
  app.get("/api/motion/templates", async () => ({ items: MOTION_TEMPLATES }));

  app.get("/api/motion/preview", async (request, reply) => {
    const query = z.object({
      template: z.string(),
      variables: z.string().optional(),
    }).parse(request.query);
    if (query.template.includes("..") || query.template.includes("/") || query.template.includes("\\")) {
      return reply.code(400).send({ error: "Đường dẫn mẫu không hợp lệ" });
    }
    let variables: Record<string, string | number> = {};
    if (query.variables) {
      try { variables = JSON.parse(query.variables) as Record<string, string | number>; }
      catch { return reply.code(400).send({ error: "Biến không phải JSON" }); }
    }
    const html = inlineMotionPreview(query.template, variables);
    if (!html) return reply.code(404).send({ error: "Không có mẫu" });
    return reply.type("text/html").send(html);
  });

  app.post("/api/motion/browser", async () => {
    const result = await runHyperframes(["browser", "ensure"]);
    return { ok: result.code === 0, output: result.output.slice(-500) };
  });

  app.post("/api/motion/trial", async () => {
    const result = await renderMotionGraphic({
      dataDir: options.dataDir,
      templateId: "title_card",
      variables: { title: "Thử đồ họa", subtitle: "Ba giây" },
      width: 540,
      height: 960,
      fps: 15,
      durationSec: 3,
      workers: 1,
    });
    return {
      ok: Boolean(result.outputPath),
      seconds: Math.round(result.seconds * 10) / 10,
      cached: result.cached,
      warning: result.warning ?? null,
    };
  });

  app.get("/api/motion/status", async () => {
    const doctor = await runHyperframes(["doctor"]);
    return { version: "0.9.14", doctor: doctor.output.slice(-800), ok: doctor.code === 0 };
  });
}

function runHyperframes(args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [hyperframesEntry(), ...args], {
      env: motionTelemetryEnv(process.env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => { killProcessTree(child.pid); }, 180_000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (code) => { clearTimeout(timer); resolvePromise({ code, output }); });
    child.on("error", () => { clearTimeout(timer); resolvePromise({ code: 1, output }); });
  });
}
