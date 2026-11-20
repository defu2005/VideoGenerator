import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { rgbToLab } from "@vg/shared";

const require = createRequire(import.meta.url);
const cache = new Map<string, number[]>();
/** Use the installed HyperFrames sharp adapter, without adding a dependency. */
export async function averageLab(path: string): Promise<number[] | null> {
  try {
    const stat = statSync(path, { bigint: true });
    const key = `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    const known = cache.get(key);
    if (known) return known;
    const engine = createRequire(require.resolve("hyperframes/package.json"));
    const sharp = engine("sharp");
    const { data, info } = await sharp(path).resize(32, 32, { fit: "inside" }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const sum = [0, 0, 0];
    let count = 0;
    for (let at = 0; at + 2 < data.length; at += info.channels) {
      const lab = rgbToLab([data[at], data[at + 1], data[at + 2]]);
      lab.forEach((value, index) => { sum[index] += value; });
      count++;
    }
    if (!count) return null;
    const lab = sum.map((value) => value / count);
    if (cache.size >= 2048) cache.clear();
    cache.set(key, lab);
    return lab;
  } catch { return null; }
}
