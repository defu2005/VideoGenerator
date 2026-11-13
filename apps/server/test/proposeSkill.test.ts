import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_TOOLS, type AssistantToolContext } from "../src/assistant/tools.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { listSkillVersions } from "../src/operator/skillVersions.js";
import { planSkillExport } from "../src/operator/skillExport.js";

const roots: string[] = [];
const handles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function context(agent: AssistantToolContext["agent"] = { kind: "codex", name: "codex-pc", model: null, environment: "may-nha" }) {
  const root = mkdtempSync(join(tmpdir(), "vg-propose-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  handles.push(opened.sqlite);
  return { sqlite: opened.sqlite, agent } as unknown as AssistantToolContext;
}

function skill(name: string, extra = "") {
  return `---
name: ${name}
description: Làm một việc thử nghiệm lặp lại trong app Video Agent
operator: true
area: tu-van-hanh
triggers:
  - thử nghiệm ${name}
tools:
  - list_projects
risk: read
---

# Thử nghiệm

## Khi nào dùng

Khi cần xem danh sách dự án.

## Các bước

1. Gọi list_projects.${extra}

## Kiểm tra kết quả

Có danh sách.

## Lỗi hay gặp

UNKNOWN_TOOL khi tên tool sai.

## Không được làm

Không xoá dự án.
`;
}

const run = (ctx: AssistantToolContext, args: unknown) => ASSISTANT_TOOLS.propose_skill!.execute(args, ctx);

describe("propose_skill", () => {
  it("is a safe tool", () => {
    expect(ASSISTANT_TOOLS.propose_skill?.risk).toBe("safe");
  });

  it("saves a valid proposal as a draft with source, caller and reason", async () => {
    const ctx = context();
    const result = await run(ctx, { markdown: skill("video-thu-nghiem"), reason: "Làm lại ba lần", basedOn: ["run-1"] });
    expect(result).toEqual({ name: "video-thu-nghiem", version: 1, status: "draft" });
    const [row] = listSkillVersions(ctx.sqlite);
    expect(row).toMatchObject({ name: "video-thu-nghiem", status: "draft" });
    expect(row?.evidence).toEqual({ source: "agent_proposal", caller: "codex:codex-pc", reason: "Làm lại ba lần", runIds: ["run-1"] });
  });

  it("rejects invalid markdown and saves nothing", async () => {
    const ctx = context();
    await expect(run(ctx, { markdown: skill("video-hong").replace("list_projects", "tool_khong_co").replace("  - tool_khong_co", "  - tool_khong_co"), reason: "x" }))
      .rejects.toMatchObject({ code: "INVALID_OPERATOR_SKILL" });
    expect(listSkillVersions(ctx.sqlite)).toEqual([]);
  });

  it("refuses a built-in name and a name outside video-*", async () => {
    const ctx = context();
    await expect(run(ctx, { markdown: skill("knowledge_refresh"), reason: "x" })).rejects.toMatchObject({ code: "BUILT_IN_SKILL" });
    await expect(run(ctx, { markdown: skill("khac-tien-to"), reason: "x" })).rejects.toMatchObject({ code: "INVALID_OPERATOR_SKILL" });
    expect(listSkillVersions(ctx.sqlite)).toEqual([]);
  });

  it("turns a second proposal for the same name into a new version draft", async () => {
    const ctx = context();
    await run(ctx, { markdown: skill("video-hai-ban"), reason: "bản một" });
    const second = await run(ctx, { markdown: skill("video-hai-ban", "\n2. Đọc kết quả."), reason: "bản hai" });
    expect(second).toMatchObject({ name: "video-hai-ban", version: 2, status: "draft" });
  });

  it("stops at the daily draft cap", async () => {
    const ctx = context();
    for (let index = 0; index < 10; index++) await run(ctx, { markdown: skill(`video-cap-${index}`), reason: "đếm" });
    await expect(run(ctx, { markdown: skill("video-cap-10"), reason: "quá" })).rejects.toMatchObject({ code: "SKILL_DRAFT_LIMIT" });
  });

  it("never activates: the proposal is a draft and nothing is active", async () => {
    const ctx = context();
    await run(ctx, { markdown: skill("video-chi-nhap"), reason: "nháp" });
    expect(listSkillVersions(ctx.sqlite, true)).toEqual([]);
  });
});

describe("planSkillExport", () => {
  const tools = new Set(Object.keys(ASSISTANT_TOOLS));
  const active = (name: string, markdown = skill(name), version = 1) => ({ name, version, markdown });

  it("creates a missing file, skips an identical one and ignores non video- names", () => {
    const same = skill("video-giong-nhau");
    const actions = planSkillExport(
      [active("video-moi"), active("video-giong-nhau", same), active("khong-video")],
      new Map([["video-giong-nhau", { content: same }]]),
      { toolNames: tools },
    );
    expect(actions.map((action) => [action.kind, action.name])).toEqual([["skip", "video-giong-nhau"], ["create", "video-moi"]]);
  });

  it("reports a conflict on a differing file, and overwrites only with write", () => {
    const files = new Map([["video-khac", { content: "cũ" }]]);
    expect(planSkillExport([active("video-khac")], files, { toolNames: tools })[0]).toMatchObject({ kind: "conflict" });
    expect(planSkillExport([active("video-khac")], files, { toolNames: tools, write: true })[0]).toMatchObject({ kind: "overwrite" });
  });

  it("reports invalid markdown without a write action", () => {
    const bad = skill("video-xau").replace("list_projects\nrisk", "tool_khong_co\nrisk");
    const [action] = planSkillExport([active("video-xau", bad)], new Map(), { toolNames: tools, write: true });
    expect(action).toMatchObject({ kind: "invalid" });
  });

  it("never writes through a symlink and takes the highest active version", () => {
    const files = new Map([["video-lien-ket", { symlink: true as const }]]);
    expect(planSkillExport([active("video-lien-ket")], files, { toolNames: tools, write: true })[0]).toMatchObject({ kind: "invalid" });
    const [picked] = planSkillExport([active("video-nhieu", skill("video-nhieu"), 1), active("video-nhieu", skill("video-nhieu", "\n2. Thêm."), 2)], new Map(), { toolNames: tools });
    expect(picked).toMatchObject({ kind: "create", version: 2 });
  });
});
