export type MetricPoint = {
  date: string; value: number | null; samples: number;
  knowledgeRev: string; format: string; definition: string;
};
export type DriftShift = { date: string; direction: "up" | "down"; baseline: number; current: number; score: number; knowledgeChanged: boolean };

/** Two-sided tabular CUSUM, in sigma units (k=.5, h=5).
 * Method: https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm
 * Our additional guards require 14 baseline days and 3 consecutive shifted days.
 * Missing/low-sample days and metric-definition boundaries never bridge a run.
 */
export function metricDrift(points: readonly MetricPoint[], minSamples = 3): DriftShift | null {
  const ordered = [...new Map(points.map(p => [p.date, p])).values()].sort((a, b) => a.date.localeCompare(b.date));
  // Warm up again after a gap/definition boundary; an old missing row must not disable detection for 180 days.
  let days: MetricPoint[] = [];
  for (const point of ordered) {
    const previous = days.at(-1);
    if (point.value === null || !Number.isFinite(point.value) || point.samples < minSamples) { days = []; continue; }
    if (previous && (Date.parse(point.date) - Date.parse(previous.date) !== 86_400_000 || previous.definition !== point.definition)) days = [];
    days.push(point);
  }
  if (days.length < 17) return null;
  const baseline = days.slice(0, 14);
  if (baseline.some(p => p.value === null || !Number.isFinite(p.value) || p.samples < minSamples)) return null;
  if (baseline.some((p, i) => i > 0 && Date.parse(p.date) - Date.parse(baseline[i - 1]!.date) !== 86_400_000)) return null;
  const definition = baseline[0]!.definition;
  if (baseline.some(p => p.definition !== definition)) return null;
  const mean = baseline.reduce((sum, p) => sum + p.value!, 0) / baseline.length;
  const sigma = Math.max(Math.sqrt(baseline.reduce((sum, p) => sum + (p.value! - mean) ** 2, 0) / 13), Math.abs(mean) * .05, .01);
  let up = 0, down = 0, upDays = 0, downDays = 0;
  let previous = baseline.at(-1)!.date;
  for (const p of days.slice(14)) {
    const gap = Date.parse(p.date) - Date.parse(previous); previous = p.date;
    if (gap !== 86_400_000 || p.value === null || !Number.isFinite(p.value) || p.samples < minSamples || p.definition !== definition) {
      up = down = upDays = downDays = 0; continue;
    }
    const z = (p.value - mean) / sigma;
    up = Math.max(0, up + z - .5); down = Math.max(0, down - z - .5);
    upDays = z > .5 ? upDays + 1 : 0; downDays = z < -.5 ? downDays + 1 : 0;
    if ((up > 5 && upDays >= 3) || (down > 5 && downDays >= 3)) return {
      date: p.date, direction: up > down ? "up" : "down", baseline: mean, current: p.value,
      score: Math.max(up, down), knowledgeChanged: !p.knowledgeRev.split(",").includes("unknown") && !baseline.at(-1)!.knowledgeRev.split(",").includes("unknown") && p.knowledgeRev !== baseline.at(-1)!.knowledgeRev,
    };
  }
  return null;
}

export function driftCategory(input: { knowledgeChanged: boolean; allPlatformChannels: boolean; oneFormat: boolean }): "E4" | "B4" | "C2" | "G1" {
  if (input.knowledgeChanged) return "G1";
  if (input.allPlatformChannels) return "B4";
  if (input.oneFormat) return "C2";
  return "E4";
}
