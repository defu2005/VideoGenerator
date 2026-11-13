import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PROFILE_TREND_SETTINGS,
  type ProfileDetail,
  type ProfileTrendSettings,
  type TrendIdea,
  type TrendItem,
  type TrendRefreshResponse,
} from "@vg/shared";
import { apiRequest } from "../../services/apiClient";
import { updateProfile } from "../../services/profilesApi";
import { profileKeys } from "../../hooks/useProfiles";

function settingsFrom(profile: ProfileDetail): ProfileTrendSettings {
  return { ...DEFAULT_PROFILE_TREND_SETTINGS, ...profile.trendSettings };
}

export function TrendsSection({ profile }: { profile: ProfileDetail }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProfileTrendSettings>(settingsFrom(profile));
  const [feedsText, setFeedsText] = useState((profile.trendSettings?.feeds ?? []).join("\n"));
  const [metaText, setMetaText] = useState((profile.trendSettings?.metaPages ?? []).join("\n"));
  const [preview, setPreview] = useState<TrendRefreshResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => updateProfile(profile.id, {
      trendSettings: {
        ...draft,
        feeds: feedsText.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 20),
        metaPages: metaText.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 100),
      },
    }),
    onSuccess: async () => {
      setMessage("Đã lưu nguồn xu hướng.");
      await queryClient.invalidateQueries({ queryKey: profileKeys.detail(profile.id) });
    },
  });

  const refresh = useMutation({
    mutationFn: () => apiRequest<TrendRefreshResponse>(`/profiles/${profile.id}/trends/refresh`, { method: "POST" }),
    onSuccess: (data) => {
      setPreview(data);
      setMessage(null);
    },
  });

  const add = useMutation({
    mutationFn: (idea: TrendIdea) => apiRequest(`/profiles/${profile.id}/trends/topics`, {
      method: "POST",
      body: JSON.stringify({ idea }),
    }),
  });

  return (
    <section className="panel form-stack" aria-label="Xu hướng">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TRENDS</p>
          <h2>Xu hướng</h2>
        </div>
      </div>
      <label className="field-checkbox">
        <input type="checkbox" checked={draft.youtubePopular} onChange={(event) => setDraft({ ...draft, youtubePopular: event.target.checked })} />
        YouTube phổ biến
      </label>
      <label className="field-checkbox">
        <input type="checkbox" checked={draft.wikimediaTop} onChange={(event) => setDraft({ ...draft, wikimediaTop: event.target.checked })} />
        Wikimedia xem nhiều
      </label>
      <label className="field-checkbox">
        <input type="checkbox" checked={draft.rss} onChange={(event) => setDraft({ ...draft, rss: event.target.checked })} />
        RSS / Atom
      </label>
      <label>
        Khu vực
        <input aria-label="Khu vực xu hướng" value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} />
      </label>
      <label>
        Ngôn ngữ
        <input aria-label="Ngôn ngữ xu hướng" value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })} />
      </label>
      <label>
        Danh mục YouTube
        <input aria-label="Danh mục YouTube" value={draft.youtubeCategoryId} onChange={(event) => setDraft({ ...draft, youtubeCategoryId: event.target.value })} />
      </label>
      <label>
        RSS (mỗi dòng một feed, tối đa 20)
        <textarea aria-label="Danh sách RSS" rows={4} value={feedsText} onChange={(event) => setFeedsText(event.target.value)} />
      </label>
      <label>
        Trang Wikipedia bỏ qua
        <textarea aria-label="Trang Wikipedia bỏ qua" rows={3} value={metaText} onChange={(event) => setMetaText(event.target.value)} />
      </label>
      <div className="button-row">
        <button className="button" type="button" disabled={save.isPending} onClick={() => void save.mutate()}>Lưu xu hướng</button>
        <button className="button button-primary" type="button" disabled={refresh.isPending} onClick={() => void refresh.mutate()}>Xem xu hướng ngay</button>
      </div>
      {message && <p>{message}</p>}
      {refresh.isError && <p>{refresh.error instanceof Error ? refresh.error.message : "Không tải được xu hướng"}</p>}
      {preview && (
        <div>
          <h3>Mục thô</h3>
          <ul>
            {preview.items.map((item: TrendItem) => <li key={`${item.source}-${item.title}`}>{item.title}</li>)}
          </ul>
          <h3>Ý tưởng khớp kênh</h3>
          <ul>
            {preview.ideas.map((idea) => (
              <li key={idea.title}>
                <strong>{idea.title}</strong>
                <p>{idea.angle}</p>
                <p>{idea.whyNow}</p>{idea.earlierProjectId && <a href={"/projects/"+idea.earlierProjectId+"/script"}>Mở video đã làm</a>}
                <button
                  className="button"
                  type="button"
                  disabled={add.isPending}
                  onClick={() => void add.mutate(idea)}
                >
                  Thêm vào hàng chờ
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
