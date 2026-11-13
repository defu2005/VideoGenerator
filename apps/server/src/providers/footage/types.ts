export type FootageFile = {
  url: string;
  width: number;
  height: number;
  bytes?: number;
};

export type FootageHit = {
  provider: "pexels" | "pixabay";
  clipId: string;
  url: string;
  width: number;
  height: number;
  durationSec: number;
  author: string;
  licenseName: string;
  pageUrl: string;
  previewImage: string;
  tags: string[];
  files: FootageFile[];
  /** Set after the file is on disk. Planning never downloads. */
  localPath?: string;
};

export type FootageSearchInput = {
  query: string;
  orientation: "landscape" | "portrait" | "square";
  minDurationSec: number;
  limit: number;
};

export type FootageProvider = {
  id: FootageHit["provider"];
  enabled(config: { PEXELS_API_KEY?: string; PIXABAY_API_KEY?: string }): boolean;
  search(input: FootageSearchInput): Promise<FootageHit[]>;
};
