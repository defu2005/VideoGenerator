import { YOUTUBE_LOCALIZATION_HINT, YOUTUBE_CAPTION_HINT, youtubeLanguageExtras } from "@vg/shared";

export type YoutubeExtraResult = {
  called: Array<"videos.update" | "captions.insert">;
  hints: string[];
};

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Same-channel localizations need the full `youtube` scope.
 * Caption upload needs `youtube.force-ssl`. Missing scopes only return a hint.
 */
export async function applyYoutubeLanguageExtras(input: {
  scopes: readonly string[];
  accessToken: string;
  videoId: string;
  language: string;
  title: string;
  description: string;
  srt: string;
  fetchImpl: FetchLike;
}): Promise<YoutubeExtraResult> {
  const plan = youtubeLanguageExtras(input.scopes);
  const called: YoutubeExtraResult["called"] = [];
  if (plan.updateLocalizations) {
    const response = await input.fetchImpl(
      "https://www.googleapis.com/youtube/v3/videos?part=localizations",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: input.videoId,
          localizations: {
            [input.language]: { title: input.title, description: input.description },
          },
        }),
      },
    );
    if (!response.ok) {
      return { called, hints: [...plan.hints, "YouTube từ chối cập nhật bản địa hoá."] };
    }
    called.push("videos.update");
  }
  if (plan.insertCaptions) {
    const response = await input.fetchImpl(
      "https://www.googleapis.com/upload/youtube/v3/captions?part=snippet",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snippet: { videoId: input.videoId, language: input.language, name: input.language },
          srt: input.srt,
        }),
      },
    );
    if (!response.ok) {
      return { called, hints: [...plan.hints, "YouTube từ chối tải phụ đề."] };
    }
    called.push("captions.insert");
  }
  return {
    called,
    hints: plan.updateLocalizations || plan.insertCaptions ? plan.hints : [YOUTUBE_LOCALIZATION_HINT, YOUTUBE_CAPTION_HINT],
  };
}

export { YOUTUBE_LOCALIZATION_HINT, YOUTUBE_CAPTION_HINT };
