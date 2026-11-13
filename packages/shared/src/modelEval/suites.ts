import { z } from "zod";
import { LlmTaskIdSchema, type LlmTaskId } from "../schemas/llm.js";

export const GraderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schema"), schemaName: z.string() }).strict(),
  z.object({ kind: z.literal("requiredKeys"), keys: z.array(z.string()).min(1) }).strict(),
  z.object({ kind: z.literal("length"), min: z.number().int().nonnegative(), max: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("vietnameseDiacritics"), minRatio: z.number().min(0).max(1) }).strict(),
  z.object({ kind: z.literal("bannedPhrases"), phrases: z.array(z.string()).min(1) }).strict(),
  z.object({ kind: z.literal("exact"), expected: z.unknown() }).strict(),
  z.object({ kind: z.literal("plantedErrors"), errors: z.array(z.string()).min(1) }).strict(),
  z.object({ kind: z.literal("toolCall"), name: z.string().min(1), args: z.record(z.string(), z.unknown()) }).strict(),
]);
export type Grader = z.infer<typeof GraderSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  taskId: LlmTaskIdSchema,
  input: z.unknown(),
  graders: z.array(GraderSchema).min(1),
}).strict();
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalSuiteSchema = z.object({
  id: z.string().min(1),
  titleVi: z.string().min(1),
  taskId: LlmTaskIdSchema,
  rubricVi: z.string().min(1),
  cases: z.array(EvalCaseSchema).min(8).max(15),
}).strict();
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

type Spec = {
  id: string;
  titleVi: string;
  taskId: LlmTaskId;
  rubricVi: string;
  graders: Grader[];
  input: (index: number) => unknown;
};

const SPECS: Spec[] = [
  {
    id: "research-summary",
    titleVi: "Tóm tắt nghiên cứu",
    taskId: "research",
    rubricVi: "Tóm tắt tiếng Việt có đủ ý và không bịa nguồn.",
    graders: [{ kind: "requiredKeys", keys: ["summary"] }, { kind: "vietnameseDiacritics", minRatio: 0.02 }],
    input: (index) => ({ topic: `Chủ đề ${index}`, notes: "Ghi chú có dấu tiếng Việt." }),
  },
  {
    id: "script-short",
    titleVi: "Kịch bản ngắn",
    taskId: "script",
    rubricVi: "Lời dẫn ngắn, tiếng Việt, đúng độ dài.",
    graders: [{ kind: "length", min: 40, max: 800 }, { kind: "bannedPhrases", phrases: ["bạn sẽ sốc"] }],
    input: (index) => ({ topic: `Kịch bản ngắn ${index}`, seconds: 60 }),
  },
  {
    id: "script-long",
    titleVi: "Kịch bản dài",
    taskId: "script",
    rubricVi: "Lời dẫn dài vẫn giữ mạch và không dùng cụm cấm.",
    graders: [{ kind: "length", min: 80, max: 4000 }, { kind: "bannedPhrases", phrases: ["đừng bỏ lỡ"] }],
    input: (index) => ({ topic: `Kịch bản dài ${index}`, seconds: 480 }),
  },
  {
    id: "script-review",
    titleVi: "Biên tập kịch bản",
    taskId: "scriptReview",
    rubricVi: "Nhận xét có điểm và lý do.",
    graders: [{ kind: "requiredKeys", keys: ["score", "notes"] }],
    input: (index) => ({ script: `Đoạn ${index} nói về sông Hồng.` }),
  },
  {
    id: "scene-json",
    titleVi: "Phân cảnh JSON",
    taskId: "sceneQueries",
    rubricVi: "JSON có danh sách cảnh và khóa bắt buộc.",
    graders: [{ kind: "schema", schemaName: "object" }, { kind: "requiredKeys", keys: ["scenes"] }],
    input: (index) => ({ narration: `Cảnh ${index} ở Hà Nội.` }),
  },
  {
    id: "image-queries",
    titleVi: "Từ khóa ảnh",
    taskId: "visualAltQueries",
    rubricVi: "Có mảng truy vấn, không rỗng.",
    graders: [{ kind: "requiredKeys", keys: ["queries"] }],
    input: (index) => ({ scene: `Ảnh tư liệu ${index}` }),
  },
  {
    id: "vision-check",
    titleVi: "Kiểm tra ảnh",
    taskId: "visionCheck",
    rubricVi: "Chấm ảnh fixture, không dùng ảnh người dùng.",
    graders: [{ kind: "exact", expected: { label: "khop" } }],
    input: (index) => ({ image: "fixtures/vision-sample.png", case: index, expect: "khop" }),
  },
  {
    id: "fact-check",
    titleVi: "Đối chiếu fact",
    taskId: "factCheck",
    rubricVi: "Phải chỉ ra lỗi đã gài.",
    graders: [{ kind: "plantedErrors", errors: ["năm sai"] }],
    input: (index) => ({ claim: `Mẫu ${index} ghi năm sai.` }),
  },
  {
    id: "metadata",
    titleVi: "Tiêu đề và mô tả",
    taskId: "metadata",
    rubricVi: "Có tiêu đề tiếng Việt trong cửa sổ độ dài.",
    graders: [{ kind: "requiredKeys", keys: ["title"] }, { kind: "vietnameseDiacritics", minRatio: 0.01 }],
    input: (index) => ({ script: `Video ${index} về ẩm thực.` }),
  },
  {
    id: "translation",
    titleVi: "Dịch và rút gọn",
    taskId: "translateScript",
    rubricVi: "Bản dịch có dấu và nằm trong cửa sổ độ dài.",
    graders: [{ kind: "length", min: 10, max: 500 }, { kind: "vietnameseDiacritics", minRatio: 0.02 }],
    input: (index) => ({ text: `Sentence ${index}`, target: "vi" }),
  },
  {
    id: "comment-class",
    titleVi: "Phân loại bình luận",
    taskId: "commentAssist",
    rubricVi: "Nhãn khớp nhãn mẫu.",
    graders: [{ kind: "exact", expected: { label: "câu hỏi" } }],
    input: (index) => ({ text: `Bình luận ${index}` }),
  },
  {
    id: "trend-match",
    titleVi: "Ghép xu hướng",
    taskId: "trendMatch",
    rubricVi: "Có ý tưởng khớp kênh.",
    graders: [{ kind: "requiredKeys", keys: ["topic"] }],
    input: (index) => ({ trend: `Xu hướng ${index}`, direction: "khoa học" }),
  },
  {
    id: "tool-choice",
    titleVi: "Chọn công cụ trợ lý",
    taskId: "assistantChat",
    rubricVi: "Đúng tên công cụ và tham số.",
    graders: [{ kind: "toolCall", name: "list_projects", args: { page: 1 } }],
    input: (index) => ({ ask: `Liệt kê dự án ${index}` }),
  },
];

export function buildEvalSuites(): EvalSuite[] {
  return SPECS.map((spec) => EvalSuiteSchema.parse({
    id: spec.id,
    titleVi: spec.titleVi,
    taskId: spec.taskId,
    rubricVi: spec.rubricVi,
    cases: Array.from({ length: 8 }, (_, index) => ({
      id: `${spec.id}-${index + 1}`,
      taskId: spec.taskId,
      input: spec.input(index + 1),
      graders: spec.graders,
    })),
  }));
}

export function listEvalSuites(): EvalSuite[] {
  return buildEvalSuites();
}
