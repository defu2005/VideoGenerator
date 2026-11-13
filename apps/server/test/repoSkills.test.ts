import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { loadRepoSkills } from "../src/operator/repoSkills.js";
import { OPERATOR_SKILLS } from "../src/operator/skills.js";
import { routeQuery } from "../src/operator/routing.js";
import { repoRoot, writeOperatorWorkspace } from "../src/operator/workspace.js";

const roots: string[] = [];
const seven = [
  "video-chien-luoc-kenh",
  "video-chon-chu-de",
  "video-giu-chan-nguoi-xem",
  "video-kiem-tra-truoc-khi-dang",
  "video-lich-san-xuat",
  "video-doc-so-lieu",
  "video-bao-cao-thu-nghiem",
];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeSkill(root: string, folder: string, markdown: string): string {
  const dir = join(root, ".agents", "skills", folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, markdown);
  return path;
}

const base = `tools:
  - get_profile
risk: read
---
## Các bước
- Đọc hồ sơ
`;

describe("repo skills", () => {
  it("loads the seven channel skills and writes their original text", () => {
    const names = new Set(Object.keys(ASSISTANT_TOOLS));
    const loaded = loadRepoSkills({
      root: repoRoot(),
      toolNames: names,
      builtinNames: new Set(OPERATOR_SKILLS.map((skill) => skill.name)),
    });
    const rejectedChannels = loaded.rejected.filter((item) => seven.some((name) => item.path.includes(name)));
    expect(rejectedChannels).toEqual([]);
    expect(seven.every((name) => loaded.skills.some((skill) => skill.name === name))).toBe(true);
    const data = mkdtempSync(join(tmpdir(), "vg-repo-ws-"));
    roots.push(data);
    const written = writeOperatorWorkspace({
      dataDir: data,
      apiUrl: "http://127.0.0.1:9",
      tools: [],
      duties: [],
      repoSkills: loaded.skills,
      snapshot: { profiles: [], waitingGates: 0, orderCount: 0, quotaLine: "mock" },
      snapshotMaxChars: 400,
      standingOrdersMarkdown: "",
    });
    const file = readFileSync(join(written.dir, "skills", "kenh", "video-lich-san-xuat.md"), "utf8");
    expect(file).toContain("name: video-lich-san-xuat");
    for (const name of seven) expect(written.handbook).toContain(`${name}:`);
  });

  it("rejects a skill that is not for the operator, names an unknown tool, or clashes", () => {
    const root = mkdtempSync(join(tmpdir(), "vg-repo-"));
    roots.push(root);
    writeSkill(root, "design-only", `---
name: design-only
description: Skill thiết kế không đưa vào operator
${base}`);
    writeSkill(root, "bad-tool", `---
name: bad-tool
description: Skill có công cụ không tồn tại
operator: true
tools:
  - missing_tool_name
risk: read
---
Thân
`);
    writeSkill(root, "wrong-folder", `---
name: right-name
description: Tên thư mục không khớp tên skill
operator: true
${base}`);
    writeSkill(root, "publish-project", `---
name: publish-project
description: Trùng kỹ năng có sẵn trong operator
operator: true
${base}`);
    writeSkill(root, "user-copy", `---
name: user-copy
description: Bản người dùng được ưu tiên hơn repo
operator: true
${base}`);
    const loaded = loadRepoSkills({
      root,
      toolNames: new Set(["get_profile"]),
      builtinNames: new Set(["publish-project"]),
      userNames: new Set(["user-copy"]),
    });
    expect(loaded.skills.map((skill) => skill.name)).toEqual([]);
    const messages = loaded.rejected.map((item) => item.errors.join(" ")).join("\n");
    expect(messages).toContain("missing_tool_name");
    expect(messages).toContain("Tên thư mục khác name");
    expect(messages).toContain("Trùng tên kỹ năng có sẵn");
    expect(messages).toContain("Trùng tên kỹ năng người dùng");
    expect(loaded.rejected.some((item) => item.path.includes("design-only"))).toBe(false);
  });

  it("re-reads a skill only after its modification time changes", () => {
    const root = mkdtempSync(join(tmpdir(), "vg-repo-mtime-"));
    roots.push(root);
    const path = writeSkill(root, "fresh-skill", `---
name: fresh-skill
description: Bản đầu của skill thử
operator: true
${base}`);
    const stamp = new Date(Math.floor(Date.now() / 1000) * 1000 - 10_000);
    utimesSync(path, stamp, stamp);
    const input = { root, toolNames: new Set(["get_profile"]), builtinNames: new Set<string>() };
    expect(loadRepoSkills(input).skills[0]?.description).toContain("Bản đầu");
    writeFileSync(path, `---
name: fresh-skill
description: Bản đã sửa của skill thử
operator: true
${base}`);
    utimesSync(path, stamp, stamp);
    expect(loadRepoSkills(input).skills[0]?.description).toContain("Bản đầu");
    utimesSync(path, new Date(), new Date());
    expect(loadRepoSkills(input).skills[0]?.description).toContain("Bản đã sửa");
  });
});

describe("channel skill routing", () => {
  const loaded = loadRepoSkills({
    root: repoRoot(),
    toolNames: new Set(Object.keys(ASSISTANT_TOOLS)),
    builtinNames: new Set(OPERATOR_SKILLS.map((skill) => skill.name)),
  });
  const candidates = [
    ...OPERATOR_SKILLS.map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      body: skill.longNotes.join(" "),
      shortBody: skill.shortSteps.join(" "),
      triggers: skill.triggers,
      antiTriggers: skill.antiTriggers,
      area: skill.area,
    })),
    ...loaded.skills.map((skill) => ({
      id: `repo:${skill.name}`,
      name: skill.name,
      description: skill.description,
      body: skill.longNotes.join(" "),
      shortBody: skill.shortSteps.join(" "),
      triggers: skill.triggers,
      antiTriggers: skill.antiTriggers,
      area: skill.area,
    })),
  ];

  function top(query: string): string[] {
    return routeQuery(query, candidates)[0]?.hits.slice(0, 3).map((hit) => hit.name) ?? [];
  }

  function picked(query: string): string[] {
    return (routeQuery(query, candidates)[0]?.hits.slice(0, 3) ?? [])
      .filter((hit) => hit.score >= 0.6 || (hit.breakdown.trigger === 1 && hit.breakdown.anti === 0))
      .map((hit) => hit.name);
  }

  it("picks the channel skill for each operating question", () => {
    expect(top("Lập lịch sản xuất tuần và cắt shorts cho kênh")).toContain("video-lich-san-xuat");
    expect(top("Nên làm kênh ngách gì để kiếm tiền")).toContain("video-chien-luoc-kenh");
    expect(top("Kiểm tra video này trước khi đăng có bị rập khuôn không")).toContain("video-kiem-tra-truoc-khi-dang");
    expect(top("Báo cáo số liệu kênh tháng này")).toContain("video-doc-so-lieu");
    expect(top("Kiểm chứng xem hướng nào hiệu quả, agent nào đã làm")).toContain("video-bao-cao-thu-nghiem");
    expect(top("Kế hoạch tuần từ lệnh thường trực")).toContain("weekly-plan");
  });

  it("leaves off-topic questions without a channel skill", () => {
    for (const query of ["Hôm nay thời tiết Hà Nội thế nào", "Kể cho tôi một câu chuyện cười", "Tính giúp 17 nhân 23"]) {
      expect(picked(query).some((name) => name.startsWith("video-"))).toBe(false);
    }
  });
});
