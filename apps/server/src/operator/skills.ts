import type { AssistantToolRisk } from "@vg/shared";

export type OperatorSkill = {
  area: string;
  topic: string;
  name: string;
  description: string;
  triggers: string[];
  antiTriggers: string[];
  tools: string[];
  risk: AssistantToolRisk;
  shortSteps: string[];
  longNotes: string[];
};

export const OPERATOR_SKILLS: OperatorSkill[] = [
  {
    area: "dang-bai",
    topic: "publish-project",
    name: "publish-project",
    description: "Đăng một dự án đã render lên tài khoản đã kết nối.",
    triggers: ["đăng", "publish", "upload", "lên youtube"],
    antiTriggers: ["xoá", "xoa", "huỷ đăng"],
    tools: ["get_project", "list_accounts", "publish_project"],
    risk: "confirm",
    shortSteps: [
      "Đọc get_project để chắc dự án đã có render.",
      "Đọc list_accounts của hồ sơ.",
      "Gọi publish_project. Việc đăng công khai thành thao tác chờ duyệt.",
      "Không nói là đã đăng khi thao tác còn chờ.",
    ],
    longNotes: [
      "Kiểm tra tài khoản đã kết nối trước khi tạo lượt đăng.",
      "Nếu visibility là public, server luôn tạo pending action.",
      "Hủy lượt đăng dùng cancel_publication và cũng cần duyệt.",
    ],
  },
  {
    area: "tro-ly",
    topic: "weekly-plan",
    name: "weekly-plan",
    description: "Lập kế hoạch tuần từ lệnh thường trực và lịch đăng.",
    triggers: ["kế hoạch tuần", "weekly", "lệnh thường trực", "tuần này"],
    antiTriggers: ["xoá", "xoa"],
    tools: ["list_profiles", "publish_calendar", "automation_status", "search_user_guide"],
    risk: "read",
    shortSteps: [
      "Đọc notes/standing-orders.md.",
      "Gọi list_profiles và publish_calendar.",
      "Gọi automation_status.",
      "Trả lịch đề xuất, không tự bật tự động hóa.",
    ],
    longNotes: [
      "Bật lịch của hồ sơ là việc confirm. Chỉ tạo pending action.",
      "Nêu rõ lệnh thường trực nào đang tắt.",
    ],
  },
  {
    area: "mo-hinh-ai",
    topic: "quota-question",
    name: "quota-question",
    description: "Trả lời câu hỏi về hạn mức model miễn phí và mức dùng.",
    triggers: ["quota", "hạn mức", "han muc", "còn lượt"],
    antiTriggers: ["tăng hạn", "bật trả phí", "paid"],
    tools: ["get_llm_quota_status", "usage_summary"],
    risk: "read",
    shortSteps: [
      "Gọi get_llm_quota_status.",
      "Gọi usage_summary cho kỳ người dùng hỏi.",
      "Nêu model gần hết lượt và chính sách đang chọn.",
    ],
    longNotes: [
      "Không đổi quotaPolicy và không nâng paidFallbackDailyUsd.",
      "Nếu số liệu thiếu, nói thiếu và đưa công cụ để xem lại.",
    ],
  },
  {
    area: "binh-luan",
    topic: "triage-comments",
    name: "triage-comments",
    description: "Xem bình luận mới, lọc spam và soạn trả lời chờ duyệt.",
    triggers: ["bình luận", "binh luan", "comment", "spam"],
    antiTriggers: ["xoá video", "xoa du an"],
    tools: ["list_comments", "reply_comment", "hide_comment"],
    risk: "confirm",
    shortSteps: [
      "Gọi list_comments.",
      "Với spam rõ, gọi hide_comment để tạo pending action.",
      "Với lời hỏi thật, gọi reply_comment để tạo pending action.",
      "Báo số bình luận đã xem và số việc chờ duyệt.",
    ],
    longNotes: [
      "Không gửi trả lời thật trước khi người dùng duyệt.",
      "Giữ giọng của hồ sơ. Không bịa số liệu.",
    ],
  },
  {
    area: "tro-giup",
    topic: "answer-guide",
    name: "answer-guide",
    description: "Trả lời câu hỏi cách dùng ứng dụng từ hướng dẫn tiếng Việt.",
    triggers: ["làm sao", "lam sao", "ở đâu", "hướng dẫn", "how do i"],
    antiTriggers: ["đăng ngay", "xóa hết"],
    tools: ["search_user_guide"],
    risk: "read",
    shortSteps: [
      "Gọi search_user_guide với câu hỏi.",
      "Trả lời bằng các mục tìm được và nêu tên mục.",
    ],
    longNotes: [
      "Nếu không có mục khớp, nói chưa thấy trong hướng dẫn.",
      "Không bịa đường dẫn nút.",
    ],
  },
];

export function skillShortBody(skill: OperatorSkill): string {
  return skill.shortSteps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

export function renderSkillMarkdown(skill: OperatorSkill): string {
  const triggers = skill.triggers.map((item) => `  - ${item}`).join("\n");
  const anti = skill.antiTriggers.map((item) => `  - ${item}`).join("\n");
  const tools = skill.tools.map((item) => `  - ${item}`).join("\n");
  const short = skill.shortSteps.map((step) => `- ${step}`).join("\n");
  const notes = skill.longNotes.map((step) => `- ${step}`).join("\n");
  return [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    "triggers:",
    triggers,
    "antiTriggers:",
    anti,
    "tools:",
    tools,
    `risk: ${skill.risk}`,
    "---",
    "",
    "## Ngan",
    short,
    "",
    "## Day du",
    notes,
    "",
  ].join("\n");
}

export type ParsedSkill = {
  name: string;
  description: string;
  triggers: string[];
  antiTriggers: string[];
  tools: string[];
  risk: string;
  shortBody: string;
  body: string;
};

export function parseSkillMarkdown(markdown: string): ParsedSkill | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const front = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const name = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
  const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
  const risk = /^risk:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
  const triggers = listUnder(front, "triggers");
  const antiTriggers = listUnder(front, "antiTriggers");
  const tools = listUnder(front, "tools");
  const shortMatch = body.match(/## Ngan\s*([\s\S]*?)(?:## Day du|$)/);
  const shortBody = (shortMatch?.[1] ?? body).trim();
  if (!name || !description) return null;
  return { name, description, triggers, antiTriggers, tools, risk, shortBody, body };
}

function listUnder(front: string, key: string): string[] {
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  - ") && !line.startsWith("- ")) {
      if (line.trim() && !line.startsWith(" ")) break;
      if (line.trim()) break;
      continue;
    }
    items.push(line.replace(/^\s*-\s*/, "").trim());
  }
  return items.filter(Boolean);
}

const SECRET = [
  /sk-[A-Za-z0-9]/,
  /oma_/,
  /Bearer\s/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
];

export function shouldProposeSkill(input: {
  toolCount: number;
  successCount: number;
  bestSkillScore: number;
}): boolean {
  return input.toolCount >= 2 && input.successCount >= 3 && input.bestSkillScore < 0.35;
}

export function validateSkillMarkdown(markdown: string, toolNames: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const parsed = parseSkillMarkdown(markdown);
  if (!parsed) {
    errors.push("Frontmatter không hợp lệ.");
    return errors;
  }
  if (!parsed.description || parsed.description.length < 8) errors.push("Thiếu description.");
  if (!["read", "safe", "confirm"].includes(parsed.risk)) errors.push("risk không hợp lệ.");
  if (parsed.tools.length === 0) errors.push("Thiếu tools.");
  for (const tool of parsed.tools) {
    if (!toolNames.has(tool)) errors.push(`Công cụ không có trong registry: ${tool}`);
  }
  if (markdown.includes("TODO") || markdown.includes("\u2026")) errors.push("Còn chữ giữ chỗ.");
  for (const pattern of SECRET) {
    if (pattern.test(markdown)) errors.push("Có dữ liệu nhạy cảm.");
  }
  return errors;
}
