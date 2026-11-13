import { LOGIN_HINT_VI } from "@vg/shared";
import type { AgentRuntime, AgentRunResult } from "./agentRuntime.js";
import { buildCursorArgs, cursorLaunch, detectCursorCli } from "./cli.js";
import { runCursorProcess, type SpawnFn } from "./runtime.js";

export function resolveCursorRuntime(cursorPath: string, spawnImpl: SpawnFn): AgentRuntime | null {
  const launch = cursorLaunch({ detected: detectCursorCli(), cursorPath });
  if (!launch) return null;
  return {
    id: "cursor",
    version: launch.version,
    capabilities: { mcp: true, resume: true, streaming: true, cancel: true },
    resumeCommand(sessionId) {
      const resume = sessionId ? ` --resume ${sessionId}` : "";
      if (launch.indexArg) return `"${launch.command}" "${launch.indexArg}"${resume}`;
      return `${launch.command}${resume}`;
    },
    async run(input) {
      const result = await runCursorProcess({
        command: launch.command,
        args: buildCursorArgs({
          indexArg: launch.indexArg,
          workspace: input.workspace,
          message: input.message,
          chatId: input.sessionId,
          model: input.model,
        }),
        cwd: input.workspace,
        env: { ...process.env, VG_OPERATOR_INVOCATION: input.invocationToken },
        timeoutMs: input.timeoutMs,
        spawnImpl,
        shouldStop: input.shouldStop,
        onDelta: input.onDelta,
        onTool: input.onTool,
      });
      let status: AgentRunResult["status"] = "completed";
      if (result.loggedOut) status = "failed";
      else if (result.timedOut) status = input.shouldStop?.() ? "cancelled" : "timedOut";
      else if (result.exitCode !== 0) status = "failed";
      return {
        sessionId: result.chatId,
        text: result.loggedOut ? LOGIN_HINT_VI : result.text,
        errorDetail: result.loggedOut ? "" : result.stderr,
        status,
        writeViolations: result.writeViolations,
      };
    },
  };
}
