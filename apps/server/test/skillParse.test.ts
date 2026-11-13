import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSkillMarkdown, validateSkillMarkdown } from "../src/operator/skills.js";

const tools = new Set(["get_profile"]);

describe("skill markdown", () => {
  it("keeps a one-line description", () => {
    const parsed = parseSkillMarkdown(`---
name: old-skill
description: Mô tả một dòng đủ dài
risk: read
tools:
  - get_profile
---
## Ngan
- Bước một
`);
    expect(parsed?.description).toBe("Mô tả một dòng đủ dài");
    expect(parsed?.shortBody).toContain("Bước một");
    expect(parsed?.operator).toBe(false);
  });

  it("joins a folded description and keeps a literal block", () => {
    const folded = parseSkillMarkdown("---\r\nname: folded\r\ndescription: >-\r\n  Dòng một của mô tả\r\n  và dòng hai\r\noperator: true\r\narea: kenh\r\nrisk: read\r\ntools:\r\n  - get_profile\r\n---\r\n## Các bước\r\n- Làm việc\r\n");
    expect(folded?.description).toBe("Dòng một của mô tả và dòng hai");
    expect(folded?.operator).toBe(true);
    expect(folded?.area).toBe("kenh");
    expect(folded?.shortBody).toContain("Làm việc");
    const literal = parseSkillMarkdown("---\nname: literal\ndescription: |\n  Dòng một\n  Dòng hai\nrisk: read\ntools:\n  - get_profile\n---\nThân\n");
    expect(literal?.description).toBe("Dòng một\nDòng hai");
  });

  it("accepts a url that contains risk-not and rejects a real secret key", () => {
    const url = `---
name: url-skill
description: Mô tả đủ dài cho skill
risk: read
tools:
  - get_profile
---
Xem https://example.com/is-a-channel-level-risk-not-a-ban
`;
    expect(validateSkillMarkdown(url, tools)).toEqual([]);
    const secret = url.replace("example.com", "sk-abcdefghijklmnopqrst");
    expect(validateSkillMarkdown(secret, tools).some((error) => error.includes("nhạy cảm"))).toBe(true);
  });

  it("reads the production-schedule skill description as prose", () => {
    const markdown = readFileSync(new URL("../../../.agents/skills/video-lich-san-xuat/SKILL.md", import.meta.url), "utf8");
    const parsed = parseSkillMarkdown(markdown);
    expect(parsed?.operator).toBe(true);
    expect(parsed?.area).toBe("kenh");
    expect(parsed?.description.startsWith("Lập và chạy nhịp")).toBe(true);
    expect(parsed?.description.includes(">-")).toBe(false);
  });
});
