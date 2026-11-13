import { buildApp } from "./app.js";
import { parseConfig } from "./lib/config.js";

if (process.env.VG_ROLE === "worker") {
  // Worker node: no database, no keys. It talks to the main machine with its node token only.
  const { runWorkerAgent } = await import("./node/agent.js");
  process.exit(await runWorkerAgent());
}

const config = parseConfig();
const app = buildApp({ config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error, "Failed to start server");
  await app.close();
  process.exitCode = 1;
}
