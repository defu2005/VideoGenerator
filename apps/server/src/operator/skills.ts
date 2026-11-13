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
  {
    area: "nha-cung-cap",
    topic: "research-provider",
    name: "research-provider",
    description: "Nghiên cứu một nhà cung cấp từ trang chính thức và chỉ ghi câu trích kiểm được.",
    triggers: ["nghiên cứu nhà cung cấp", "nghien cuu nha cung cap", "research provider"],
    antiTriggers: ["xoá", "xoa", "trả tiền", "áp dụng route"],
    tools: [
      "intel_fetch_page",
      "intel_submit_assessment",
      "intel_add_provider_stub",
      "intel_set_offer",
      "get_provider",
      "intel_next_research_batch",
      "intel_mark_researched",
      "intel_write_report",
      "intel_extract_page",
    ],
    risk: "read",
    shortSteps: [
      "Lấy batch hoặc đọc hồ sơ hiện có.",
      "Lấy trang chính thức và ghi nhận định khi câu trích khớp.",
      "Đánh dấu đã nghiên cứu và viết báo cáo ngắn.",
    ],
    longNotes: [
      "Không đoán giá, điều khoản hay quốc gia.",
      "Không áp dụng định tuyến và không thêm thẻ.",
    ],
  },
  {
    area: "nha-cung-cap",
    topic: "compare-models",
    name: "compare-models",
    description: "So sánh model theo điểm đánh giá và đề xuất chuỗi, chưa tự áp dụng.",
    triggers: ["so sánh model", "so sanh model", "compare models"],
    antiTriggers: ["áp dụng ngay", "cập nhật omniroute"],
    tools: [
      "get_model_scorecard",
      "compare_models",
      "list_eval_suites",
      "run_model_eval",
      "get_model_task_stats",
      "get_model_abilities",
      "propose_route_change",
    ],
    risk: "confirm",
    shortSteps: [
      "Đọc bảng điểm và thống kê lần chạy thật.",
      "So sánh theo hồ sơ định tuyến.",
      "Nếu cần đổi chuỗi, gọi propose_route_change và chờ người dùng duyệt.",
    ],
    longNotes: [
      "Khi có quyền nhà cung cấp, thử model mới trên 2 dự án rồi mới áp dụng cho hồ sơ. Kém hơn thì hoàn tác.",
      "Không bật paid_fallback, không đổi key.",
    ],
  },
  {
    area: "tri-thuc",
    topic: "knowledge-refresh",
    name: "knowledge_refresh",
    description: "Đọc tối đa năm mục tri thức cũ hoặc đến hạn và đề xuất cập nhật kèm nguồn.",
    triggers: ["làm mới tri thức", "tri thức cũ", "knowledge refresh"],
    antiTriggers: ["duyệt giúp", "tự chấp nhận", "nhấc giữ"],
    tools: ["list_stale_knowledge", "get_knowledge", "propose_knowledge_change"],
    risk: "confirm",
    shortSteps: [
      "Gọi list_stale_knowledge và chỉ lấy tối đa 5 mục.",
      "Đọc get_knowledge và trang watch của từng mục.",
      "Nếu có câu trích khớp, gọi propose_knowledge_change.",
    ],
    longNotes: [
      "Không gọi công cụ chấp nhận đề xuất.",
      "Không nhấc một lần giữ mức nghiêm trọng.",
    ],
  },
  {
    area: "tri-thuc",
    topic: "change-investigation",
    name: "change_investigation",
    description: "Điều tra một thay đổi: giả thuyết và các phép đối chiếu chỉ đọc.",
    triggers: ["điều tra thay đổi", "vì sao số liệu đổi", "change investigation"],
    antiTriggers: ["chấp nhận tri thức", "nhấc giữ nghiêm trọng"],
    tools: ["list_change_events", "get_knowledge", "get_account_health", "get_metric_series"],
    risk: "read",
    shortSteps: [
      "Đọc list_change_events cho sự kiện đang mở.",
      "Đối chiếu kênh khác, nền tảng khác, cùng tuần năm trước, phiên bản tri thức và lỗi đồng bộ.",
      "Ghi nhận định ngắn và bước tiếp trên sự kiện. Chỉ chạy phép đọc.",
    ],
    longNotes: [
      "Giả thuyết: nền tảng đổi, nội dung của mình đổi, yếu tố mùa, lỗi dữ liệu hoặc đồng bộ.",
      "Không chấp nhận tri thức và không nhấc giữ mức nghiêm trọng.",
    ],
  },
  {
    area: "tri-thuc",
    topic: "research-brief",
    name: "research_brief",
    description: "Soạn bản giao việc cho Codex từ danh sách tri thức cũ, theo dạng RESEARCH-071 và RESEARCH-072.",
    triggers: ["soạn brief", "giao codex", "research brief"],
    antiTriggers: ["tự nhập tri thức", "chấp nhận đề xuất"],
    tools: ["list_stale_knowledge"],
    risk: "read",
    shortSteps: [
      "Đọc list_stale_knowledge.",
      "Viết brief để người dùng đưa cho Codex.",
      "Kết quả quay lại qua import_knowledge do người dùng xác nhận.",
    ],
    longNotes: [
      "Skill không tự nhập và không tự duyệt.",
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
  operator: boolean;
  area: string;
  shortBody: string;
  body: string;
};

export function parseSkillMarkdown(markdown: string): ParsedSkill | null {
  const match = markdown.replaceAll("\r\n", "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const front = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const name = scalar(front, "name");
  const description = scalar(front, "description");
  const risk = scalar(front, "risk");
  const area = scalar(front, "area");
  const operator = scalar(front, "operator") === "true";
  const triggers = listUnder(front, "triggers");
  const antiTriggers = listUnder(front, "antiTriggers");
  const tools = listUnder(front, "tools");
  const ngan = body.match(/## Ngan\s*([\s\S]*?)(?:\n## |$)/);
  const steps = body.match(/## Các bước\s*([\s\S]*?)(?:\n## |$)/);
  const shortBody = (ngan?.[1] ?? steps?.[1] ?? body).trim();
  if (!name || !description) return null;
  return { name, description, triggers, antiTriggers, tools, risk, operator, area, shortBody, body };
}

function scalar(front: string, key: string): string {
  const lines = front.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return "";
  const raw = lines[index]?.slice(key.length + 1).trim() ?? "";
  if (raw !== ">" && raw !== ">-" && raw !== "|" && raw !== "|-") return raw;
  const block: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (line.startsWith(" ") || line.startsWith("\t")) block.push(line.trim());
    else if (line.trim() === "") block.push("");
    else break;
  }
  const text = raw.startsWith("|") ? block.join("\n") : block.filter((line) => line.length > 0).join(" ");
  return text.trim();
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
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/,
  /oma_/,
  /Bearer\s/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
];

export function textHasSecret(value: string): boolean {
  return SECRET.some((pattern) => pattern.test(value));
}

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
