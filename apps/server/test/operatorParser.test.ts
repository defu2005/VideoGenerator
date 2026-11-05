import { describe, expect, it } from "vitest";
import { looksLoggedOut, mergeStreamText, parseStreamLine } from "../src/operator/parser.js";
import { buildCursorArgs } from "../src/operator/cli.js";
import { isCronDue } from "../src/operator/cron.js";

describe("operator stream parser", () => {
  it("reads init, text, tool chips and the final result", () => {
    expect(parseStreamLine('{"type":"system","subtype":"init","session_id":"chat-9"}')).toEqual({
      type: "init",
      chatId: "chat-9",
    });
    expect(parseStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"Xin"}]}}')).toEqual({
      type: "delta",
      text: "Xin",
    });
    expect(parseStreamLine('{"type":"tool_use","name":"list_projects"}')).toEqual({
      type: "tool",
      name: "list_projects",
    });
    expect(parseStreamLine('{"type":"tool_use","subtype":"completed","name":"list_projects"}')).toEqual({
      type: "ignore",
    });
    expect(parseStreamLine('{"type":"result","result":"Xong"}')).toEqual({ type: "result", text: "Xong" });
    expect(parseStreamLine("not json")).toEqual({ type: "ignore" });
  });

  it("keeps a growing snapshot and detects login failures", () => {
    expect(mergeStreamText("Xin", "Xin chào")).toBe("Xin chào");
    expect(mergeStreamText("Xin", " chào")).toBe("Xin chào");
    expect(looksLoggedOut("Error: not logged in")).toBe(true);
    expect(looksLoggedOut("đã xong")).toBe(false);
  });

  it("never puts force flags on the cursor command", () => {
    const args = buildCursorArgs({
      indexArg: "index.js",
      workspace: "C:/data/operator",
      message: "kiểm tra",
      chatId: "chat-1",
      model: "composer",
    });
    expect(args).toContain("--resume");
    expect(args).toContain("chat-1");
    expect(args).toContain("--output-format");
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("-f");
  });

  it("fires a cron only once in the same minute", () => {
    const now = new Date("2026-11-05T01:00:00.000Z");
    expect(isCronDue("* * * * *", now, null)).toBe(true);
    expect(isCronDue("* * * * *", now, now.toISOString())).toBe(false);
  });
});
