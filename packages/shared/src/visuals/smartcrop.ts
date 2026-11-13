/**
 * Content-aware crop focus for an RGBA buffer.
 *
 * The score (saturation, local contrast, and a centre bias) follows the approach
 * of smartcrop.js by Jonas Wagner, MIT licence:
 * https://github.com/jwagner/smartcrop.js
 * This file is a short TypeScript scorer for the crop tool. It is not a
 * line-by-line copy of that project.
 */

export function smartcropFocus(
  image: { width: number; height: number; data: Uint8Array },
  targetAspect: number,
): { x: number; y: number } {
  const { width, height, data } = image;
  if (width < 2 || height < 2 || data.length < width * height * 4) {
    return { x: 0.5, y: 0.5 };
  }
  let maxWidth = width;
  let maxHeight = Math.max(2, Math.round(maxWidth / targetAspect));
  if (maxHeight > height) {
    maxHeight = height;
    maxWidth = Math.max(2, Math.round(maxHeight * targetAspect));
  }
  let best = { x: 0.5, y: 0.5, score: -1 };
  for (const scale of [1, 0.6, 0.35]) {
    const boxWidth = Math.max(2, Math.round(maxWidth * scale));
    const boxHeight = Math.max(2, Math.round(maxHeight * scale));
    const stepX = Math.max(1, Math.round(boxWidth / 6));
    const stepY = Math.max(1, Math.round(boxHeight / 6));
    for (let y = 0; y + boxHeight <= height; y += stepY) {
      for (let x = 0; x + boxWidth <= width; x += stepX) {
        const score = scoreBox(data, width, x, y, boxWidth, boxHeight);
        if (score > best.score) {
          best = { x: (x + boxWidth / 2) / width, y: (y + boxHeight / 2) / height, score };
        }
      }
    }
  }
  return { x: best.x, y: best.y };
}

function scoreBox(data: Uint8Array, stride: number, x: number, y: number, width: number, height: number): number {
  let total = 0;
  let count = 0;
  const pixelStep = Math.max(1, Math.floor(Math.min(width, height) / 12));
  for (let py = y; py < y + height; py += pixelStep) {
    for (let px = x; px < x + width; px += pixelStep) {
      const index = (py * stride + px) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const right = (py * stride + Math.min(stride - 1, px + 1)) * 4;
      const contrast = Math.abs(red - (data[right] ?? 0)) / 255;
      total += saturation * 2 + contrast + max / 255;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}
