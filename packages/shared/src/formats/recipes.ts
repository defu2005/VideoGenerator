import { z } from "zod";
import type { EditPresetId, SubtitleStyleId } from "../edit/plan.js";
import { MOTION_TEMPLATE_IDS, type MotionTemplateId } from "../motion/templates.js";

export const FORMAT_RECIPE_IDS = [
  "explainer",
  "listicle",
  "story",
  "news_recap",
  "myth_vs_fact",
  "how_to",
  "short_hook",
] as const;
export type FormatRecipeId = (typeof FORMAT_RECIPE_IDS)[number];

const SectionSchema = z.object({
  key: z.string().min(1),
  nameVi: z.string().min(1),
  purposeVi: z.string().min(1),
  shareOfDuration: z.number().min(0).max(1),
  required: z.boolean(),
}).strict();

const GraphicHintSchema = z.object({
  templateId: z.enum(MOTION_TEMPLATE_IDS),
  sectionKey: z.string().min(1),
}).strict();

export const FormatRecipeSchema = z.object({
  id: z.enum(FORMAT_RECIPE_IDS),
  nameVi: z.string().min(1),
  descriptionVi: z.string().min(1),
  aspects: z.array(z.enum(["16:9", "9:16", "1:1"])).min(1),
  durationRangeSec: z.tuple([z.number().positive(), z.number().positive()]),
  script: z.object({
    structure: z.array(SectionSchema).min(2),
    hookMaxSec: z.number().positive(),
    hookStyles: z.array(z.string()).min(1),
    ctaPosition: z.enum(["end", "loop"]),
    sentenceMaxWords: z.number().int().positive(),
    readingLevelVi: z.string().min(1),
  }).strict(),
  scenes: z.object({
    targetSceneSec: z.tuple([z.number().positive(), z.number().positive()]),
    visualMix: z.array(z.enum(["photo", "illustration", "chart", "text"])).min(1),
  }).strict(),
  edit: z.object({
    preset: z.enum(["calm", "energetic", "news", "story"]),
    subtitleStyle: z.enum(["clean", "karaoke", "pop", "box"]),
    graphics: z.array(GraphicHintSchema),
    rhythm: z.enum(["calm", "energetic", "news", "story"]),
  }).strict(),
  research: z.object({
    depth: z.enum(["light", "normal", "deep"]),
    citeOnScreen: z.boolean(),
  }).strict(),
}).strict();
export type FormatRecipe = z.infer<typeof FormatRecipeSchema>;

function recipe(input: {
  id: FormatRecipeId;
  nameVi: string;
  descriptionVi: string;
  aspects?: FormatRecipe["aspects"];
  durationRangeSec: [number, number];
  structure: FormatRecipe["script"]["structure"];
  hookMaxSec: number;
  hookStyles: string[];
  ctaPosition?: "end" | "loop";
  sentenceMaxWords: number;
  readingLevelVi: string;
  targetSceneSec: [number, number];
  visualMix: FormatRecipe["scenes"]["visualMix"];
  preset: EditPresetId;
  subtitleStyle: SubtitleStyleId;
  graphics: { templateId: MotionTemplateId; sectionKey: string }[];
  depth: "light" | "normal" | "deep";
  citeOnScreen?: boolean;
}): FormatRecipe {
  return {
    id: input.id,
    nameVi: input.nameVi,
    descriptionVi: input.descriptionVi,
    aspects: input.aspects ?? ["16:9", "9:16", "1:1"],
    durationRangeSec: input.durationRangeSec,
    script: {
      structure: input.structure,
      hookMaxSec: input.hookMaxSec,
      hookStyles: input.hookStyles,
      ctaPosition: input.ctaPosition ?? "end",
      sentenceMaxWords: input.sentenceMaxWords,
      readingLevelVi: input.readingLevelVi,
    },
    scenes: { targetSceneSec: input.targetSceneSec, visualMix: input.visualMix },
    edit: {
      preset: input.preset,
      subtitleStyle: input.subtitleStyle,
      graphics: input.graphics,
      rhythm: input.preset,
    },
    research: { depth: input.depth, citeOnScreen: input.citeOnScreen ?? false },
  };
}

export const FORMAT_RECIPES: Record<FormatRecipeId, FormatRecipe> = {
  explainer: recipe({
    id: "explainer",
    nameVi: "Giải thích",
    descriptionVi: "Một câu hỏi mở, rồi bối cảnh, ba ý chính, kết luận và lời kêu gọi.",
    durationRangeSec: [60, 600],
    structure: [
      { key: "hook", nameVi: "Câu hỏi", purposeVi: "Đặt câu hỏi người xem muốn biết đáp án.", shareOfDuration: 0.08, required: true },
      { key: "context", nameVi: "Bối cảnh", purposeVi: "Nói vì sao câu hỏi này đáng trả lời.", shareOfDuration: 0.15, required: true },
      { key: "point", nameVi: "Ý chính", purposeVi: "Ba ý, mỗi ý một hình và một câu chốt.", shareOfDuration: 0.52, required: true },
      { key: "takeaway", nameVi: "Đúc kết", purposeVi: "Một câu người xem nhớ được.", shareOfDuration: 0.15, required: true },
      { key: "cta", nameVi: "Kêu gọi", purposeVi: "Mời xem tiếp hoặc theo dõi.", shareOfDuration: 0.1, required: true },
    ],
    hookMaxSec: 8,
    hookStyles: ["câu hỏi", "con số"],
    sentenceMaxWords: 22,
    readingLevelVi: "Nói như đang giải thích cho một người lớn chưa biết chủ đề.",
    targetSceneSec: [5, 9],
    visualMix: ["photo", "illustration", "chart"],
    preset: "calm",
    subtitleStyle: "karaoke",
    graphics: [
      { templateId: "title_card", sectionKey: "hook" },
      { templateId: "number_counter", sectionKey: "point" },
      { templateId: "end_card", sectionKey: "cta" },
    ],
    depth: "normal",
  }),
  listicle: recipe({
    id: "listicle",
    nameVi: "Danh sách",
    descriptionVi: "Mở bằng số lượng, rồi từng mục, một mục thưởng và lời kêu gọi.",
    durationRangeSec: [45, 480],
    structure: [
      { key: "hook", nameVi: "Mở số", purposeVi: "Nói rõ có bao nhiêu mục.", shareOfDuration: 0.08, required: true },
      { key: "item", nameVi: "Mục", purposeVi: "Mỗi mục một mục. Đánh số.", shareOfDuration: 0.72, required: true },
      { key: "bonus", nameVi: "Thưởng", purposeVi: "Một ý thêm ngoài danh sách.", shareOfDuration: 0.1, required: false },
      { key: "cta", nameVi: "Kêu gọi", purposeVi: "Mời bình luận mục yêu thích.", shareOfDuration: 0.1, required: true },
    ],
    hookMaxSec: 6,
    hookStyles: ["số lượng"],
    sentenceMaxWords: 18,
    readingLevelVi: "Câu ngắn. Mỗi mục một ý.",
    targetSceneSec: [4, 8],
    visualMix: ["photo", "text"],
    preset: "energetic",
    subtitleStyle: "pop",
    graphics: [
      { templateId: "list_item", sectionKey: "item" },
      { templateId: "end_card", sectionKey: "cta" },
    ],
    depth: "light",
  }),
  story: recipe({
    id: "story",
    nameVi: "Kể chuyện",
    descriptionVi: "Mở giữa hành động, rồi bối cảnh, cao trào, bước ngoặt và bài học.",
    durationRangeSec: [90, 900],
    structure: [
      { key: "cold_open", nameVi: "Mở giữa chuyện", purposeVi: "Bắt đầu ở khoảnh khắc căng nhất.", shareOfDuration: 0.1, required: true },
      { key: "setup", nameVi: "Bối cảnh", purposeVi: "Ai, ở đâu, trước khi chuyện xảy ra.", shareOfDuration: 0.2, required: true },
      { key: "rising", nameVi: "Leo thang", purposeVi: "Mỗi cảnh thêm một trở ngại.", shareOfDuration: 0.35, required: true },
      { key: "twist", nameVi: "Bước ngoặt", purposeVi: "Một sự thật đổi cách nhìn.", shareOfDuration: 0.2, required: true },
      { key: "lesson", nameVi: "Bài học", purposeVi: "Một câu người xem mang theo.", shareOfDuration: 0.15, required: true },
    ],
    hookMaxSec: 12,
    hookStyles: ["cảnh giữa chuyện"],
    sentenceMaxWords: 24,
    readingLevelVi: "Giọng kể, có nhịp, tránh liệt kê.",
    targetSceneSec: [6, 12],
    visualMix: ["photo", "illustration"],
    preset: "story",
    subtitleStyle: "clean",
    graphics: [
      { templateId: "title_card", sectionKey: "cold_open" },
      { templateId: "quote_card", sectionKey: "twist" },
    ],
    depth: "normal",
  }),
  news_recap: recipe({
    id: "news_recap",
    nameVi: "Tin tóm tắt",
    descriptionVi: "Tiêu đề, chuyện gì đã xảy ra, con số, vì sao quan trọng, việc tiếp theo.",
    durationRangeSec: [45, 300],
    structure: [
      { key: "headline", nameVi: "Tiêu đề", purposeVi: "Một câu sự việc.", shareOfDuration: 0.1, required: true },
      { key: "what", nameVi: "Chuyện gì", purposeVi: "Ai, cái gì, khi nào.", shareOfDuration: 0.3, required: true },
      { key: "numbers", nameVi: "Con số", purposeVi: "Một hoặc hai số có nguồn.", shareOfDuration: 0.2, required: true },
      { key: "why", nameVi: "Vì sao", purposeVi: "Ảnh hưởng tới người xem.", shareOfDuration: 0.25, required: true },
      { key: "next", nameVi: "Tiếp theo", purposeVi: "Việc sẽ xảy ra hoặc cần theo dõi.", shareOfDuration: 0.15, required: true },
    ],
    hookMaxSec: 6,
    hookStyles: ["tiêu đề"],
    sentenceMaxWords: 20,
    readingLevelVi: "Giọng tin, không phóng đại.",
    targetSceneSec: [4, 8],
    visualMix: ["photo", "chart", "text"],
    preset: "news",
    subtitleStyle: "box",
    graphics: [
      { templateId: "lower_third", sectionKey: "what" },
      { templateId: "number_counter", sectionKey: "numbers" },
      { templateId: "bar_chart", sectionKey: "numbers" },
    ],
    depth: "deep",
    citeOnScreen: true,
  }),
  myth_vs_fact: recipe({
    id: "myth_vs_fact",
    nameVi: "Tin đồn và sự thật",
    descriptionVi: "Nêu tin đồn, vì sao người ta tin, rồi sự thật có dẫn chứng. Lặp ba lần, rồi tóm tắt.",
    durationRangeSec: [60, 420],
    structure: [
      { key: "myth", nameVi: "Tin đồn", purposeVi: "Nêu điều người ta hay nói.", shareOfDuration: 0.18, required: true },
      { key: "belief", nameVi: "Vì sao tin", purposeVi: "Nguồn của hiểu lầm, không chế giễu.", shareOfDuration: 0.15, required: true },
      { key: "fact", nameVi: "Sự thật", purposeVi: "Một bằng chứng cụ thể.", shareOfDuration: 0.45, required: true },
      { key: "summary", nameVi: "Tóm tắt", purposeVi: "Ba sự thật trên một câu.", shareOfDuration: 0.22, required: true },
    ],
    hookMaxSec: 7,
    hookStyles: ["tin đồn"],
    sentenceMaxWords: 20,
    readingLevelVi: "Tách rõ phần tin đồn và phần sự thật.",
    targetSceneSec: [5, 9],
    visualMix: ["photo", "text"],
    preset: "news",
    subtitleStyle: "karaoke",
    graphics: [
      { templateId: "quote_card", sectionKey: "myth" },
      { templateId: "lower_third", sectionKey: "fact" },
    ],
    depth: "deep",
    citeOnScreen: true,
  }),
  how_to: recipe({
    id: "how_to",
    nameVi: "Hướng dẫn",
    descriptionVi: "Cho xem kết quả trước, rồi thứ cần có, các bước, một lỗi hay gặp và nhắc lại.",
    durationRangeSec: [45, 600],
    structure: [
      { key: "result", nameVi: "Kết quả", purposeVi: "Cho thấy thành phẩm ngay.", shareOfDuration: 0.1, required: true },
      { key: "needs", nameVi: "Cần gì", purposeVi: "Liệt kê ngắn thứ phải có.", shareOfDuration: 0.12, required: true },
      { key: "step", nameVi: "Bước", purposeVi: "Mỗi bước một số và một hành động.", shareOfDuration: 0.55, required: true },
      { key: "mistake", nameVi: "Lỗi hay gặp", purposeVi: "Một lỗi và cách tránh.", shareOfDuration: 0.13, required: true },
      { key: "recap", nameVi: "Nhắc lại", purposeVi: "Đọc lại các bước.", shareOfDuration: 0.1, required: true },
    ],
    hookMaxSec: 6,
    hookStyles: ["kết quả trước"],
    sentenceMaxWords: 16,
    readingLevelVi: "Câu mệnh lệnh, một động từ mỗi câu.",
    targetSceneSec: [4, 8],
    visualMix: ["photo", "text"],
    preset: "calm",
    subtitleStyle: "clean",
    graphics: [
      { templateId: "title_card", sectionKey: "result" },
      { templateId: "list_item", sectionKey: "step" },
    ],
    depth: "light",
  }),
  short_hook: recipe({
    id: "short_hook",
    nameVi: "Video ngắn",
    descriptionVi: "Mở trong 1,5 giây, một ý, rồi câu kết vòng lại câu mở.",
    aspects: ["9:16"],
    durationRangeSec: [15, 45],
    structure: [
      { key: "hook", nameVi: "Mở", purposeVi: "Một hình và một câu trong 1,5 giây.", shareOfDuration: 0.2, required: true },
      { key: "idea", nameVi: "Một ý", purposeVi: "Chỉ một thông tin.", shareOfDuration: 0.55, required: true },
      { key: "punch", nameVi: "Câu kết", purposeVi: "Vòng lại câu mở.", shareOfDuration: 0.25, required: true },
    ],
    hookMaxSec: 1.5,
    hookStyles: ["câu cụt"],
    ctaPosition: "loop",
    sentenceMaxWords: 12,
    readingLevelVi: "Câu rất ngắn, đọc to vẫn kịp hình.",
    targetSceneSec: [2, 5],
    visualMix: ["photo", "text"],
    preset: "energetic",
    subtitleStyle: "pop",
    graphics: [
      { templateId: "kinetic_word", sectionKey: "hook" },
      { templateId: "progress_bar", sectionKey: "idea" },
    ],
    depth: "light",
  }),
};

export function formatRecipe(id: string | null | undefined): FormatRecipe | null {
  if (!id || !(id in FORMAT_RECIPES)) return null;
  return FORMAT_RECIPES[id as FormatRecipeId];
}

export function recipeSectionKeys(recipe: FormatRecipe): string[] {
  return recipe.script.structure.map((section) => section.key);
}
