import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry } from "../images/http.js";
import type { FootageFile, FootageHit, FootageProvider, FootageSearchInput } from "./types.js";

type PixabaySize = { url?: string; width?: number; height?: number; size?: number; thumbnail?: string };
type PixabayHit = {
  id?: number;
  pageURL?: string;
  tags?: string;
  duration?: number;
  user?: string;
  videos?: { large?: PixabaySize; medium?: PixabaySize; small?: PixabaySize; tiny?: PixabaySize };
};

const SIZES = ["large", "medium", "small", "tiny"] as const;

export class PixabayFootageProvider implements FootageProvider {
  readonly id = "pixabay" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: typeof fetch) {}
  enabled(config: { PIXABAY_API_KEY?: string }): boolean {
    return Boolean(config.PIXABAY_API_KEY?.trim());
  }

  async search(input: FootageSearchInput): Promise<FootageHit[]> {
    const url = new URL("https://pixabay.com/api/videos/");
    url.search = new URLSearchParams({
      key: this.config.PIXABAY_API_KEY ?? "",
      q: input.query.slice(0, 100),
      per_page: String(Math.min(Math.max(input.limit, 3), 200)),
      safesearch: "true",
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
    }) as { hits?: PixabayHit[] };
    return (data.hits ?? []).flatMap((hit) => toHit(hit, input));
  }
}

function toHit(hit: PixabayHit, input: FootageSearchInput): FootageHit[] {
  const author = hit.user?.trim() ?? "";
  const durationSec = hit.duration ?? 0;
  if (!author || !hit.id || !hit.pageURL || durationSec < input.minDurationSec || durationSec > 60) return [];
  const files: FootageFile[] = [];
  let preview = "";
  for (const name of SIZES) {
    const size = hit.videos?.[name];
    if (!size?.url || !size.width || !size.height) continue;
    if (!preview && size.thumbnail) preview = size.thumbnail;
    files.push({ url: size.url, width: size.width, height: size.height, bytes: size.size });
  }
  const oriented = files.filter((file) => matchesOrientation(file, input.orientation));
  const chosen = oriented.length ? oriented : files;
  const best = [...chosen].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!best) return [];
  return [{
    provider: "pixabay",
    clipId: String(hit.id),
    url: best.url,
    width: best.width,
    height: best.height,
    durationSec,
    author,
    licenseName: "Pixabay Content License",
    pageUrl: hit.pageURL,
    previewImage: preview,
    tags: (hit.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    files: chosen,
  }];
}

function matchesOrientation(file: FootageFile, orientation: FootageSearchInput["orientation"]): boolean {
  if (orientation === "square") return Math.abs(file.width - file.height) / Math.max(file.width, file.height) < 0.08;
  if (orientation === "portrait") return file.height > file.width;
  return file.width >= file.height;
}
