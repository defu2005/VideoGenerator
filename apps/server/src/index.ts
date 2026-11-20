import { join } from "node:path";
import { buildApp } from "./app.js";
import { parseConfig } from "./lib/config.js";
import { warmPreviewRuntime } from "./preview/shotRenderer.js";
import { ensureProposalRoot } from "./operator/proposalWiring.js";
import { repoRoot } from "./operator/workspace.js";

if (process.env.VG_ROLE === "worker") {
  // Worker node: no database, no keys. It talks to the main machine with its node token only.
  const { runWorkerAgent } = await import("./node/agent.js");
  process.exit(await runWorkerAgent());
}

const config = parseConfig();
const app = buildApp({
  config,
  proposalDraft: { root: join(repoRoot(), "docs", "proposals"), ensureRoot: ensureProposalRoot },
  tasksRoot: join(repoRoot(), "docs", "tasks"),
});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  // TASK-139b: preview is served by this process. Warm its once-per-process cost in the background; failures only log.
  void warmPreviewRuntime().then((result) => app.log.info({ preview: result }, "Preview runtime warm-up"));
} catch (error) {
  app.log.error(error, "Failed to start server");
  await app.close();
  process.exitCode = 1;
}
