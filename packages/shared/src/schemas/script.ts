import { z } from "zod";

export const ResearchNotesSchema = z.object({
  summary: z.string().min(1),
  keyFacts: z.array(z.object({
    fact: z.string().min(1),
    confidence: z.enum(["high", "medium", "low"]),
    sourceHint: z.string().nullable(),
  }).strict()).min(5).max(12),
  timeline: z.array(z.object({
    date: z.string(),
    event: z.string().min(1),
  }).strict()).max(10),
  angles: z.array(z.string().min(1)).max(6),
  outline: z.array(z.object({
    section: z.string().min(1),
    purpose: z.string().min(1),
    points: z.array(z.string()),
  }).strict()).min(3).max(8),
  cautions: z.array(z.string()).max(6),
}).strict();
export type ResearchNotes = z.infer<typeof ResearchNotesSchema>;

export const ScriptEnergySchema = z.enum(["low", "medium", "high"]);

const ScriptSectionObjectSchema = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  narration: z.string(),
  visualQueries: z.object({
    primary: z.string(),
    alternatives: z.array(z.string()).max(3).default([]),
  }).default({ primary: "", alternatives: [] }),
  visualNotes: z.string().default(""),
  musicMood: z.string().default(""),
  energy: ScriptEnergySchema.default("medium"),
  estDurationSec: z.number().nonnegative().default(0),
}).strict();

export const ScriptSectionSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const section = { ...value as Record<string, unknown> };
  if (Array.isArray(section.visualIdeas)) {
    const ideas = section.visualIdeas.filter((idea): idea is string => typeof idea === "string");
    if (section.visualQueries === undefined) {
      section.visualQueries = { primary: ideas[0] ?? "", alternatives: ideas.slice(1, 4) };
    }
    if (section.visualNotes === undefined) section.visualNotes = ideas.join(", ");
    delete section.visualIdeas;
  }
  return section;
}, ScriptSectionObjectSchema);
export type ScriptSection = z.infer<typeof ScriptSectionSchema>;

export const ScriptMusicSchema = z.object({
  mood: z.string().default(""),
  energy: ScriptEnergySchema.default("medium"),
  keywords: z.array(z.string()).default([]),
}).strict();

export const ScriptSchema = z.object({
  title: z.string().min(1),
  hook: z.string(),
  sections: z.array(ScriptSectionSchema).min(1),
  outro: z.string(),
  music: ScriptMusicSchema.default({ mood: "", energy: "medium", keywords: [] }),
}).strict();
export type Script = z.infer<typeof ScriptSchema>;

export const MergedStorySchema = z.object({
  research: ResearchNotesSchema,
  script: ScriptSchema,
}).strict();
export type MergedStory = z.infer<typeof MergedStorySchema>;
export const SaveScriptInputSchema = ScriptSchema;
export type SaveScriptInput = z.infer<typeof SaveScriptInputSchema>;

export const StoredResearchSchema = z.object({
  data: ResearchNotesSchema,
  provider: z.string(),
  model: z.string(),
  cached: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const StoredScriptSchema = z.object({
  data: ScriptSchema,
  origin: z.enum(["AGENT", "USER"]),
  edited: z.boolean(),
  version: z.number().int().positive(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export const ScriptDataSchema = z.object({
  script: StoredScriptSchema.nullable(),
  research: StoredResearchSchema.nullable(),
  origin: z.enum(["AGENT", "USER"]).nullable(),
  version: z.number().int().nonnegative(),
  stale: z.boolean(),
}).strict();
export type ScriptData = z.infer<typeof ScriptDataSchema>;
