#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVideoAgentTools } from "./tools.js";

const server = new McpServer({
  name: "video-agent-mcp",
  version: "0.1.0",
});
registerVideoAgentTools(server);

try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
