import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry } from "../images/http.js";
import type { FootageHit, FootageProvider, FootageSearchInput } from "./types.js";

type PexelsVideo = {
  id?: number;
  url?: string;
  image?: string;
  duration?: number;
  user?: { name?: string; url?: string };
  video_files?: { file_type?: string; width?: number; height?: number; link?: string }[];
};

export class PexelsFootageProvider implements FootageProvider {
  readonly id = "pexels" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: typeof fetch) {}
  enabled(config: { PEXELS_API_KEY?: string }): boolean {
    return Boolean(config.PEXELS_API_KEY?.trim());
  }

  async search(input: FootageSearchInput): Promise<FootageHit[]> {
    const url = new URL("https://api.pexels.com/videos/search");
    url.search = new URLSearchParams({
      query: input.query,
      orientation: input.orientation,
      per_page: String(Math.min(Math.max(input.limit, 1), 80)),
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      init: {
        headers: {
          "User-Agent": this.config.IMAGE_SEARCH_USER_AGENT || "video-agent",
          Authorization: this.config.PEXELS_API_KEY ?? "",
        },
      },
    }) as { videos?: PexelsVideo[] };
    return (data.videos ?? []).flatMap((video) => toHit(video, input.minDurationSec));
  }
}

function toHit(video: PexelsVideo, minDurationSec: number): FootageHit[] {
  const author = video.user?.name?.trim() ?? "";
  const durationSec = video.duration ?? 0;
  if (!author || !video.id || durationSec < minDurationSec || durationSec > 60) return [];
  const files = (video.video_files ?? []).flatMap((file) => {
    if (!file.link || !file.width || !file.height) return [];
    if (file.file_type && file.file_type !== "video/mp4") return [];
    return [{ url: file.link, width: file.width, height: file.height }];
  });
  const best = [...files].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!best || !video.url) return [];
  return [{
    provider: "pexels",
    clipId: String(video.id),
    url: best.url,
    width: best.width,
    height: best.height,
    durationSec,
    author,
    licenseName: "Pexels License",
    pageUrl: video.url,
    previewImage: video.image ?? "",
    tags: [],
    files,
  }];
}
