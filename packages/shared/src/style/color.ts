/** Colour maths for the style system (TASK-106). Pure, no DOM. */

export type Rgb = [number, number, number];

export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];

export function parseHex(value: string | null | undefined): Rgb | null {
  const hex = (value ?? "").trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

export function toHex(rgb: Rgb): string {
  return "#" + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Linear mix in sRGB: 0 gives `a`, 1 gives `b`. */
export function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  return a.map((n, i) => n + ((b[i] ?? 0) - n) * amount) as Rgb;
}

/** WCAG 2 relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRgb(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG contrast of two hex colours. An unreadable colour counts as black. */
export function contrastRatio(a: string, b: string): number {
  return contrastRgb(parseHex(a) ?? BLACK, parseHex(b) ?? BLACK);
}

/**
 * Moves `color` towards `toward` in steps of `step` until it reaches `min` contrast against
 * `against`. Stops after 60 steps, so the result is always defined.
 */
export function pushContrast(color: Rgb, against: Rgb, min: number, toward: Rgb, step = 0.1): Rgb {
  let next = color;
  for (let i = 0; i < 60 && contrastRgb(next, against) < min; i += 1) next = mixRgb(next, toward, step);
  return next;
}

function toOklab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((n) => {
    const s = n / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Perceptual distance of two hex colours in OKLab, scaled so black to white is 1.
 * Two unreadable colours are at distance 0.
 */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = toOklab(parseHex(a) ?? BLACK);
  const [l2, a2, b2] = toOklab(parseHex(b) ?? BLACK);
  return Math.min(1, Math.hypot(l1 - l2, a1 - a2, b1 - b2));
}
