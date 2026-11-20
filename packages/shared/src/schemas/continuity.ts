import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const ids = z.array(z.string().uuid()).max(200);
export const ContinuityPlanSchema = z.object({
  characters: z.array(z.object({ id: text, description: text, appearsInScenes: ids, referenceQuery: text }).strict()).max(12),
  palette: z.object({ temperature: z.enum(["warm", "neutral", "cool"]), saturation: z.enum(["low", "mid", "high"]),
    dominantHues: z.array(z.string().regex(/^#[a-fA-F0-9]{6}$/)).max(6) }).strict(),
  pacing: z.object({ hook: z.number().min(1).max(60), body: z.number().min(1).max(60), outro: z.number().min(1).max(60) }).strict(),
  motifs: z.array(z.object({ id: text, description: text, scenes: ids }).strict()).max(3),
  avoid: z.array(text).max(12),
}).strict();
export type ContinuityPlan = z.infer<typeof ContinuityPlanSchema>;
export const ContinuityEnvelopeSchema = z.object({ version: z.literal(1), plan: ContinuityPlanSchema,
  sourceHash: z.string(), weight: z.number().min(0).max(0.2).default(0.05), note: z.string().optional() }).strict();
export type ContinuityEnvelope = z.infer<typeof ContinuityEnvelopeSchema>;
export const ContinuityFindingSchema = z.object({ code: z.enum(["color_jump", "pacing", "motif_missing", "character_mismatch"]),
  sceneIds: ids, message: text, suggestedFix: text }).strict();
export type ContinuityFinding = z.infer<typeof ContinuityFindingSchema>;
export const ContinuityReportSchema = z.object({ dimension: z.literal("continuity"), findings: z.array(ContinuityFindingSchema),
  characterCheck: z.enum(["skipped", "checked"]), characterReason: z.string(), estimatedPacing: z.boolean() }).strict();
export type ContinuityReport = z.infer<typeof ContinuityReportSchema>;

export function emptyContinuityPlan(): ContinuityPlan {
  return { characters: [], palette: { temperature: "neutral", saturation: "mid", dominantHues: [] },
    pacing: { hook: 3, body: 5, outro: 4 }, motifs: [], avoid: [] };
}

/** Additive queries only; scoped to scenes with a recurring character or motif. */
export function continuityQueries(plan: ContinuityPlan | undefined, sceneId: string, original: string[]): string[] {
  if (!plan) return original;
  const characters = plan.characters.filter((item) => item.appearsInScenes.includes(sceneId));
  const motifs = plan.motifs.filter((item) => item.scenes.includes(sceneId));
  if (!characters.length && !motifs.length) return original;
  const look = `${plan.palette.temperature} colors ${plan.palette.saturation} saturation`;
  return [...new Set([...original, ...characters.map((item) => `${item.referenceQuery} ${look}`),
    ...motifs.map((item) => `${original[0] ?? ""} ${item.description} ${look}`)])];
}

/** sRGB -> CIE Lab D65. Design inspired by colorthief/node-vibrant; no vendored code. */
export function rgbToLab(rgb: readonly number[]): [number, number, number] {
  const [r, g, b] = rgb.map((value) => { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
  const f = (n: number) => n > 216 / 24389 ? Math.cbrt(n) : n * 841 / 108 + 4 / 29;
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const zed = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - zed)];
}
export function labDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}
export function paletteLabs(plan: ContinuityPlan): number[][] {
  return plan.palette.dominantHues.map((hex) => rgbToLab([1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))));
}
export function continuityScore(plan: ContinuityPlan, lab: readonly number[], previous: readonly number[] | null,
  duration: number, kind: "hook" | "section" | "outro"): number {
  const colors = paletteLabs(plan);
  const distance = colors.length ? Math.min(...colors.map((target) => labDistance(lab, target))) : 0;
  const neighbor = previous ? labDistance(lab, previous) : 0;
  const target = plan.pacing[kind === "section" ? "body" : kind];
  return Math.max(0, 1 - (distance + neighbor) / 200 - Math.abs(duration - target) / target * 0.2);
}

export function continuityFindings(plan: ContinuityPlan, scenes: Array<{ id: string; kind: "hook" | "section" | "outro";
  duration: number; lab: number[] | null; tags: string[]; shots?: number[] }>): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [];
  for (const [index, scene] of scenes.entries()) {
    const previous = scenes[index - 1];
    if (scene.lab && previous?.lab && labDistance(scene.lab, previous.lab) > 35) findings.push({ code: "color_jump",
      sceneIds: [previous.id, scene.id], message: "Màu giữa hai cảnh thay đổi mạnh.", suggestedFix: "Đổi sang ứng viên kế tiếp gần bảng màu hơn." });
    const target = plan.pacing[scene.kind === "section" ? "body" : scene.kind];
    // Chỉ đánh giá nhịp khi có shot đã kiểm chứng (compose plan hợp lệ). Không có shot thì không có finding pacing:
    // độ dài cảnh không phải nhịp cắt, và ước lượng số shot từ mục tiêu không mang thông tin.
    const shotList = scene.shots && scene.shots.length > 0 ? scene.shots : [];
    for (const shotDur of shotList) {
      if (Math.abs(shotDur - target) > target * 0.4) {
        findings.push({ code: "pacing", sceneIds: [scene.id],
          message: `Nhịp shot ${shotDur.toFixed(1)}s khác mục tiêu ${target}s quá 40%.`,
          suggestedFix: "Điều chỉnh độ dài shot theo định hướng nhịp." });
        break;
      }
    }
    for (const motif of plan.motifs.filter((item) => item.scenes.includes(scene.id))) {
      if (!scene.tags.some((tag) => tag.toLocaleLowerCase() === motif.id.toLocaleLowerCase())) findings.push({ code: "motif_missing", sceneIds: [scene.id],
        message: `Chưa có tag chứng minh motif: ${motif.description}.`, suggestedFix: `Tìm lại cảnh với motif ${motif.description}.` });
    }
  }
  return findings;
}
