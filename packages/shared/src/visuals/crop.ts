export type CropBox = { x: number; y: number; width: number; height: number };

export function planCrop(input: {
  width: number;
  height: number;
  targetAspect: number;
  focus?: { x: number; y: number };
  subjectBox?: CropBox;
  sameRatioScale?: number;
  ratioTolerance?: number;
}): { box: CropBox; rule: "fit_ratio" | "same_ratio_scale"; keepsSubject: boolean } {
  const scale = input.sameRatioScale ?? 0.9;
  const tolerance = input.ratioTolerance ?? 0.02;
  const imageAspect = input.width / input.height;
  const sameRatio = Math.abs(imageAspect - input.targetAspect) / input.targetAspect <= tolerance;
  let width: number;
  let height: number;
  if (sameRatio) {
    width = even(Math.round(input.width * scale));
    height = even(Math.round(input.height * scale));
  } else if (imageAspect > input.targetAspect) {
    height = even(input.height);
    width = even(Math.round(height * input.targetAspect));
  } else {
    width = even(input.width);
    height = even(Math.round(width / input.targetAspect));
  }
  width = Math.min(width, even(input.width));
  height = Math.min(height, even(input.height));
  const focus = input.focus ?? { x: 0.5, y: 0.5 };
  let x = Math.round(focus.x * input.width - width / 2);
  let y = Math.round(focus.y * input.height - height / 2);
  x = clamp(x, 0, input.width - width);
  y = clamp(y, 0, input.height - height);
  let keepsSubject = true;
  if (input.subjectBox) {
    const subject = input.subjectBox;
    if (subject.width <= width && subject.height <= height) {
      if (subject.x < x) x = subject.x;
      if (subject.y < y) y = subject.y;
      if (subject.x + subject.width > x + width) x = subject.x + subject.width - width;
      if (subject.y + subject.height > y + height) y = subject.y + subject.height - height;
      x = clamp(x, 0, input.width - width);
      y = clamp(y, 0, input.height - height);
      keepsSubject = subject.x >= x && subject.y >= y
        && subject.x + subject.width <= x + width + 1
        && subject.y + subject.height <= y + height + 1;
    } else {
      keepsSubject = false;
    }
  }
  return {
    box: { x, y, width, height },
    rule: sameRatio ? "same_ratio_scale" : "fit_ratio",
    keepsSubject,
  };
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
