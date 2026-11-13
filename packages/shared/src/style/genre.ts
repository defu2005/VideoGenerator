import { z } from "zod";
import { EditPresetIdSchema } from "../edit/plan.js";
import { FORMAT_RECIPE_IDS, FORMAT_RECIPES, FormatRecipeSchema, type FormatRecipe, type FormatRecipeId } from "../formats/recipes.js";
import { StyleTokensPatchSchema, type StyleTokensPatch } from "./tokens.js";

/**
 * Genre packs (TASK-106). A genre is data: which script recipe it uses, which shot kinds and
 * templates the director may reach for, its pacing and its default style hints.
 *
 * The script structure is not copied here. A pack points at a recipe in formats/recipes.ts
 * (`recipe.ref`) or, for a genre with a new structure, carries one inline in the same schema.
 * The director reads `genreDirectives(pack)` and never compares genre or recipe ids itself.
 */

export const GENRE_SHOT_KINDS = ["still", "footage", "kinetic_text", "chart", "map", "compare", "quote_full", "list_full"] as const;

const KindRuleSchema = z.object({
  /** The director may use this kind when the narration calls for it. */
  enabled: z.boolean().default(true),
  /** Use it even without a textual trigger when the scene can carry it (myth vs fact → compare). */
  force: z.boolean().default(false),
  /** Template folders that may render this kind. Left out: the folder named like the kind. */
  templates: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).optional(),
}).strict();

export const GenrePackSchema = z.object({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  nameVi: z.string().min(1).max(60),
  descriptionVi: z.string().min(1).max(240),
  recipe: z.union([
    z.object({ ref: z.enum(FORMAT_RECIPE_IDS) }).strict(),
    z.object({ inline: FormatRecipeSchema.omit({ id: true }) }).strict(),
  ]),
  director: z.object({
    /**
     * How a scene opens: `hook_first` puts a kinetic hook on the first scene only,
     * `hook_every` on every scene, `list_after_first` opens the later scenes as list items.
     */
    opening: z.enum(["hook_first", "hook_every", "list_after_first"]).default("hook_first"),
    /**
     * A scene with no "so với" / "trước … sau" cue still gets a compare card split at its middle
     * (the myth vs fact pattern). Needs at least 4 words in the scene.
     */
    compareFallback: z.boolean().default(false),
    kinds: z.partialRecord(z.enum(GENRE_SHOT_KINDS), KindRuleSchema).default({}),
    /** Extra lines for the LLM director prompt. English, one instruction each. */
    llmNotes: z.array(z.string().min(1).max(300)).max(8).default([]),
  }).strict(),
  pacing: z.object({
    preset: EditPresetIdSchema,
    paceScale: z.number().min(0.6).max(1.5).default(1),
  }).strict().optional(),
  /** Default style hints. The channel pack wins over them. */
  style: StyleTokensPatchSchema.default({}),
}).strict();
export type GenrePack = z.infer<typeof GenrePackSchema>;
export type GenrePackInput = z.input<typeof GenrePackSchema>;

const NO_MAP = { map: { enabled: false }, list_full: { enabled: false } };

function wrap(ref: FormatRecipeId, director: GenrePackInput["director"], style: StyleTokensPatch = {}): GenrePackInput {
  const recipe = FORMAT_RECIPES[ref];
  return { schema: 1, id: ref, nameVi: recipe.nameVi, descriptionVi: recipe.descriptionVi, recipe: { ref }, director, style };
}

/**
 * The seven existing formats as genre packs. Their director rules are exactly the checks that
 * are hard-coded in compose/director today (rules.ts and kinds070.ts).
 * The packs after them show a new genre added as data only; `top_facts` has no director code of its own.
 */
const BUILTIN: GenrePackInput[] = [
  wrap("explainer", { kinds: { list_full: { enabled: false } } }),
  wrap("listicle", { opening: "list_after_first", kinds: { map: { enabled: false } } }),
  wrap("story", { kinds: NO_MAP }),
  wrap("news_recap", { kinds: { list_full: { enabled: false } } }),
  wrap("myth_vs_fact", { compareFallback: true, kinds: { ...NO_MAP, compare: { force: true } } }),
  wrap("how_to", { kinds: { map: { enabled: false } } }),
  wrap("short_hook", { opening: "hook_every", kinds: NO_MAP }),
  {
    schema: 1,
    id: "history",
    nameVi: "Lịch sử",
    descriptionVi: "Kể một sự kiện lịch sử: bối cảnh, diễn biến, bước ngoặt và di sản. Có bản đồ và trích dẫn.",
    recipe: { ref: "story" },
    director: {
      kinds: { list_full: { enabled: false } },
      llmNotes: ["Prefer a map when the scene names where the event happened, and a quote when a historical figure is cited."],
    },
    pacing: { preset: "story", paceScale: 1.1 },
    style: { motion: { ease: "gentle", speed: 0.9 }, background: { grain: true } },
  },
  {
    schema: 1,
    id: "finance",
    nameVi: "Tài chính",
    descriptionVi: "Giải thích một chủ đề tiền bạc bằng con số: biểu đồ, so sánh trước và sau.",
    recipe: { ref: "explainer" },
    director: {
      kinds: { map: { enabled: false }, list_full: { enabled: true } },
      llmNotes: ["Prefer a chart for any two or more comparable figures, and a compare card for before and after."],
    },
    pacing: { preset: "news", paceScale: 1 },
    style: { layout: { family: "grid" }, graphics: { maxShare: 0.4 } },
  },
  {
    schema: 1,
    id: "travel",
    nameVi: "Du lịch",
    descriptionVi: "Danh sách điểm đến hoặc trải nghiệm, mỗi mục có nơi chốn trên bản đồ.",
    recipe: { ref: "listicle" },
    director: {
      opening: "list_after_first",
      kinds: { map: { enabled: true } },
      llmNotes: ["Show a map the first time a destination is named."],
    },
    pacing: { preset: "energetic", paceScale: 1.1 },
    style: { motion: { entrances: ["rise", "fade"] } },
  },
  {
    schema: 1,
    id: "top_facts",
    nameVi: "Top sự thật",
    descriptionVi: "Một danh sách sự thật bất ngờ: mỗi mục mở bằng thẻ danh sách, có bản đồ khi nhắc tới nơi chốn và thẻ so sánh khi đối chiếu.",
    recipe: { ref: "listicle" },
    director: {
      opening: "list_after_first",
      compareFallback: true,
      kinds: { map: { enabled: true }, list_full: { enabled: true }, compare: { force: true } },
      llmNotes: ["Open each fact as a list item, show a map when a place is named, and use a compare card when two things are set against each other."],
    },
    pacing: { preset: "energetic", paceScale: 1 },
    style: {},
  },
];

export const GENRE_PACKS: Record<string, GenrePack> = Object.fromEntries(
  BUILTIN.map((pack) => [pack.id, GenrePackSchema.parse(pack)]),
);

/** A pack by id: user packs first, then the built-in ones. */
export function genrePack(id: string | null | undefined, extra?: Record<string, GenrePack>): GenrePack | null {
  if (!id) return null;
  return extra?.[id] ?? GENRE_PACKS[id] ?? null;
}

/** The recipe a pack uses, in the existing FormatRecipe shape. An inline recipe takes the pack's id. */
export function genreRecipe(pack: GenrePack): FormatRecipe | (Omit<FormatRecipe, "id"> & { id: string }) {
  if ("ref" in pack.recipe) return FORMAT_RECIPES[pack.recipe.ref];
  return { ...pack.recipe.inline, id: pack.id };
}

export type GenreDirectives = {
  genreId: string;
  /** A compare card even without a compare cue (split the scene in the middle). */
  compareFallback: boolean;
  /** Kinetic hook on scenes after the first. */
  hookEveryScene: boolean;
  /** Scenes after the first open as a list item card. */
  listOpening: boolean;
  /** Kinds the director must not use. */
  disabledKinds: string[];
  /** Kinds to use even without a textual trigger. */
  forcedKinds: string[];
  /** Template folders per kind, first is the default. */
  templates: Record<string, string[]>;
  llmNotes: string[];
  pacing: { preset: z.infer<typeof EditPresetIdSchema>; paceScale: number };
};

/** Everything the director needs from a genre, flattened. */
export function genreDirectives(pack: GenrePack): GenreDirectives {
  const kinds = pack.director.kinds;
  const templates: Record<string, string[]> = {};
  for (const kind of GENRE_SHOT_KINDS) templates[kind] = kinds[kind]?.templates ?? [kind];
  const recipe = genreRecipe(pack);
  return {
    genreId: pack.id,
    compareFallback: pack.director.compareFallback,
    hookEveryScene: pack.director.opening === "hook_every",
    listOpening: pack.director.opening === "list_after_first",
    disabledKinds: GENRE_SHOT_KINDS.filter((kind) => kinds[kind]?.enabled === false),
    forcedKinds: GENRE_SHOT_KINDS.filter((kind) => kinds[kind]?.force === true && kinds[kind]?.enabled !== false),
    templates,
    llmNotes: [...pack.director.llmNotes],
    pacing: pack.pacing ?? { preset: recipe.edit.rhythm, paceScale: 1 },
  };
}

/** Directives for a recipe id the way the director gets it today. Unknown ids behave like `explainer`. */
export function directivesForRecipe(recipeId: string, extra?: Record<string, GenrePack>): GenreDirectives {
  return genreDirectives(genrePack(recipeId, extra) ?? GENRE_PACKS.explainer!);
}
