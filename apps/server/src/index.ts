import { buildApp } from "./app.js";
import { parseConfig } from "./lib/config.js";

const config = parseConfig();
const app = buildApp({ config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error, "Failed to start server");
  await app.close();
  process.exitCode = 1;
}
