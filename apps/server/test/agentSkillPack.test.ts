import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { loadRepoSkills } from "../src/operator/repoSkills.js";
import { OPERATOR_SKILLS, parseSkillMarkdown } from "../src/operator/skills.js";
import { repoRoot } from "../src/operator/workspace.js";

const root = repoRoot();
const toolNames = new Set(Object.keys(ASSISTANT_TOOLS));
const builtinNames = new Set(OPERATOR_SKILLS.map((skill) => skill.name));

const EXPECTED_VIDEO_SKILLS = [
  "video-van-hanh-app", "video-du-an-va-pipeline", "video-hinh-anh-va-giong", "video-render-va-thumbnail",
  "video-dang-bai", "video-binh-luan", "video-ho-so-kenh", "video-mo-hinh-ai", "video-tu-dong-hoa",
  "video-xu-ly-su-co", "video-trich-xuat-ky-nang",
];

/** User guide pages that are not a feature area. */
const META_PAGES = new Set(["README", "nhat-ky-thay-doi", "thuat-ngu"]);

/** Areas only the user operates; the hub lists them with a guide link instead of an action skill. */
const USER_ONLY_AREAS: Record<string, string> = {
  "dang-nhap": "Mật khẩu và phiên đăng nhập là việc của người dùng.",
  "ket-noi": "OAuth nền tảng và khóa là việc của người dùng; agent không được chạm vào.",
  "khong-gian-va-quyen": "Vai trò và quyền chỉ chủ app đổi.",
  "an-toan": "Trang giải thích giới hạn an toàn; không có thao tác cho agent.",
  "cai-dat": "Cài đặt máy và app do người dùng làm.",
  "may-worker": "Máy worker thử nghiệm: chỉ chủ sở hữu và quản trị thêm hoặc gỡ máy.",
  "tro-ly-va-telegram":"Ghép Telegram dùng token, chỉ người dùng làm.",
};

/** Guide page → skill that covers it when the skill's own `area` is a different page. */
const AREA_TO_SKILL: Record<string, string> = {
  "phan-tich-va-tai-chinh": "video-doc-so-lieu",
  "che-do-ngan-sach": "video-mo-hinh-ai",
  "tri-thuc-va-thay-doi": "knowledge_refresh",
};

/** Registry tools no skill lists yet, each with the reason. A stale entry fails the test. */
const UNCOVERED_TOOLS: Record<string, string> = {
  notification_settings: "Thông báo là cài đặt riêng của người dùng.",
  update_notification_toggles: "Thông báo là cài đặt riêng của người dùng.",
  delete_project: "Xoá dự án chỉ người dùng làm; skill dự án cấm tool này.",
  list_goals: "Mục tiêu đọc qua get_goal_progress trong video-doc-so-lieu.",
  knowledge_status: "Tri thức có skill dựng sẵn knowledge_refresh; chưa có skill repo.",
  list_knowledge: "Tri thức có skill dựng sẵn knowledge_refresh; chưa có skill repo.",
  import_knowledge: "Nhập tri thức là việc của skill dựng sẵn knowledge_refresh.",
  list_change_catalog: "Thay đổi bên ngoài có skill dựng sẵn change_investigation.",
  mark_change_reviewed: "Thay đổi bên ngoài có skill dựng sẵn change_investigation.",
  resolve_change_event: "Thay đổi bên ngoài có skill dựng sẵn change_investigation.",
  report_change: "Thay đổi bên ngoài có skill dựng sẵn change_investigation.",
  computer_use_status: "Điều khiển máy là tính năng riêng, tắt mặc định.",
  computer_observe: "Điều khiển máy là tính năng riêng, tắt mặc định.",
  computer_act: "Điều khiển máy là tính năng riêng, tắt mặc định.",
  list_connections: "Kết nối OAuth là vùng chỉ người dùng.",
  get_provider_intel_summary: "Nghiên cứu nhà cung cấp có skill dựng sẵn research-provider.",
  list_intel_changes: "Nghiên cứu nhà cung cấp có skill dựng sẵn research-provider.",
  list_offers: "Nghiên cứu nhà cung cấp có skill dựng sẵn research-provider.",
  intel_run_job: "Nghiên cứu nhà cung cấp có skill dựng sẵn research-provider.",
  intel_submit_benchmark: "Nghiên cứu nhà cung cấp có skill dựng sẵn research-provider.",
  get_omniroute_audit: "Sửa OmniRoute là thay đổi hạ tầng; skill model chỉ đọc và đề xuất.",
  apply_routing_proposal: "Áp dụng route là việc người dùng duyệt trong app.",
  update_omniroute_combos: "Sửa combo OmniRoute chỉ người dùng làm.",
  omniroute_set_provider_state: "Bật tắt provider OmniRoute chỉ người dùng làm.",
  omniroute_upsert_combo: "Sửa combo OmniRoute chỉ người dùng làm.",
  omniroute_delete_combo: "Xoá combo OmniRoute chỉ người dùng làm.",
  get_eval_run: "Đánh giá model chạy trong trang Model; chưa có skill vận hành.",
};

function repo() {
  return loadRepoSkills({ root, toolNames, builtinNames });
}
function videoSkillFiles(): Array<{ name: string; markdown: string }> {
  const dir = join(root, ".agents", "skills");
  return readdirSync(dir)
    .filter((name) => name.startsWith("video-") && existsSync(join(dir, name, "SKILL.md")))
    .map((name) => ({ name, markdown: readFileSync(join(dir, name, "SKILL.md"), "utf8") }));
}

describe("agent skill pack", () => {
  it("loads every video-* skill with no rejection", () => {
    const loaded = repo();
    expect(loaded.rejected).toEqual([]);
    const names = new Set(loaded.skills.map((skill) => skill.name));
    for (const name of EXPECTED_VIDEO_SKILLS) expect(names.has(name), name).toBe(true);
    for (const file of videoSkillFiles()) expect(names.has(file.name), file.name).toBe(true);
  });

  it("names every skill of the hub task table, and each exists", () => {
    const hub = readFileSync(join(root, ".agents", "skills", "video-van-hanh-app", "SKILL.md"), "utf8");
    const table = hub.slice(hub.indexOf("## Bảng việc nào dùng skill nào"), hub.indexOf("## Giới hạn cứng"));
    const named = [...table.matchAll(/`(video-[a-z0-9-]+)`/g)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThanOrEqual(EXPECTED_VIDEO_SKILLS.length - 1);
    const existing = new Set(repo().skills.map((skill) => skill.name));
    for (const name of named) expect(existing.has(name), name).toBe(true);
  });

  it("covers every user guide area or lists it as user-only", () => {
    const pages = readdirSync(join(root, "docs", "user-guide")).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3));
    const areas = new Set(repo().skills.map((skill) => skill.area));
    const known = new Set([...repo().skills.map((skill) => skill.name), ...builtinNames]);
    for (const page of pages) {
      if (META_PAGES.has(page) || page in USER_ONLY_AREAS) continue;
      const mapped = AREA_TO_SKILL[page];
      const covered = areas.has(page) || (mapped !== undefined && known.has(mapped));
      expect(covered, `trang ${page} chưa có skill`).toBe(true);
    }
    for (const [area, reason] of Object.entries(USER_ONLY_AREAS)) {
      expect(reason.length, area).toBeGreaterThan(10);
      expect(pages, area).toContain(area);
    }
    const hub = readFileSync(join(root, ".agents", "skills", "video-van-hanh-app", "SKILL.md"), "utf8");
    for (const area of Object.keys(USER_ONLY_AREAS)) expect(hub, area).toContain(`${area}.md`);
  });

  it("lists every registry tool in some skill or in UNCOVERED_TOOLS with a reason", () => {
    const used = new Set<string>();
    for (const skill of OPERATOR_SKILLS) for (const tool of skill.tools) used.add(tool);
    for (const skill of repo().skills) for (const tool of skill.tools) used.add(tool);
    const missing = [...toolNames].filter((tool) => !used.has(tool)).sort();
    expect(missing).toEqual(Object.keys(UNCOVERED_TOOLS).sort());
    for (const [tool, reason] of Object.entries(UNCOVERED_TOOLS)) expect(reason.length, tool).toBeGreaterThan(10);
  });

  it("keeps secrets, emails and the protected project out of skill bodies", () => {
    for (const { name, markdown } of videoSkillFiles()) {
      expect(markdown, name).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(markdown, name).not.toMatch(/\bsk-[A-Za-z0-9]{8,}|\boma_[A-Za-z0-9]+|Bearer\s+\S+|\b[a-f0-9]{40,}\b/);
      for (const line of markdown.split("\n")) {
        if (line.includes(PROTECTED_PROJECT_ID)) expect(line, name).toMatch(/không|cấm/i);
      }
      expect(parseSkillMarkdown(markdown)?.operator, name).toBe(true);
    }
  });
});
