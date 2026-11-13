/** dHash: 9×8 greyscale, each pixel compared with the one on its right. 64 bits. */

export const PHASH_SAME_MAX = 6;
export const PHASH_NEAR_MAX = 12;

export function dHashFromGray(pixels: Uint8Array, width = 9, height = 8): bigint {
  if (pixels.length < width * height) {
    throw new Error("Không đủ điểm ảnh để tính hash.");
  }
  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const left = pixels[y * width + x] ?? 0;
      const right = pixels[y * width + x + 1] ?? 0;
      if (left > right) hash |= 1n << bit;
      bit += 1n;
    }
  }
  return hash;
}

export function hamming(left: bigint, right: bigint): number {
  let value = left ^ right;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

export function hashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, "0");
}

export function hexToHash(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

export function hashesMatch(left: string | undefined, right: string | undefined, max = PHASH_SAME_MAX): boolean {
  if (!left || !right) return false;
  return hamming(hexToHash(left), hexToHash(right)) <= max;
}
