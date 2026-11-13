import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KnowledgeFreshness, MarketDefaultField, MarketPack, ProfileDetail } from "@vg/shared";
import { ApiRequestError, apiRequest } from "../../services/apiClient";
import { accountConnectionKeys } from "../../services/publishApi";
import { profileKeys, useUpdateProfile } from "../../hooks/useProfiles";
import { Modal } from "../../components/ui/Modal";

type MarketChoice = { code: string; name: string };
type MarketInfo = { pack: MarketPack; freshness: KnowledgeFreshness };
type Change = { field: MarketDefaultField; from: string | string[]; to: string | string[]; recentlyEdited: boolean };
const freshness = { fresh: "Mới", due: "Cần kiểm tra", stale: "Cũ" };
const fieldLabels: Record<MarketDefaultField, string> = {
  language: "Ngôn ngữ hồ sơ", timezone: "Múi giờ khán giả", publishTimes: "Giờ đăng",
  "trendSettings.region": "Khu vực xu hướng", "trendSettings.language": "Ngôn ngữ xu hướng",
};
const platformLabels = { youtube: "YouTube", tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram" };
const programLabels: Record<string, string> = {
  youtubePartnerProgram: "Chương trình Đối tác YouTube", tiktokCreatorRewards: "TikTok Creator Rewards",
  facebookContentMonetization: "Facebook Content Monetization", instagramNativeMonetization: "Kiếm tiền trên Instagram",
  tiktokShopAffiliate: "Tiếp thị liên kết TikTok Shop",
};
const usd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "USD" });
const languageNames = new Intl.DisplayNames("vi", { type: "language" });
const showValue = (value: string | string[]) => Array.isArray(value) ? value.join(", ") : value;
const searchKey = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d");
const availability = (value: string | boolean | null) => value === true ? "Có" : value === false ? "Không" : value ?? "Chưa rõ";

export function useMarketInfo(code: string) {
  return useQuery({
    queryKey: ["markets", code], enabled: Boolean(code),
    queryFn: () => apiRequest<MarketInfo>(`/markets/${encodeURIComponent(code)}`),
  });
}

export function MarketPicker({ value, onChange, disabled }: {
  value: string; onChange: (code: string) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const id = useId();
  const markets = useQuery({
    queryKey: ["markets"],
    queryFn: () => apiRequest<{ markets: MarketChoice[] }>("/markets"),
  });
  const entries = markets.data?.markets ?? [];
  const needle = searchKey(search.trim());
  const visible = entries.filter(({ code, name }) => code === value || searchKey(`${name} ${code}`).includes(needle));
  return <div className="form-row">
    <label className="form-field">
      <span>Tìm thị trường</span>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên hoặc mã quốc gia" disabled={disabled} />
    </label>
    <label className="form-field" htmlFor={id}>
      <span>Thị trường</span>
      <select id={id} value={value} disabled={disabled} onChange={(event) => { setSearch(""); onChange(event.target.value); }}>
        <option value="">Chưa chọn</option>
        {value && !entries.some(({ code }) => code === value) && <option value={value}>{value}</option>}
        {visible.map(({ code, name }) => <option value={code} key={code}>{name} ({code})</option>)}
      </select>
      {markets.isError && <small role="alert">Không tải được danh sách thị trường.</small>}
    </label>
  </div>;
}

export function MarketInfoCard({ info }: { info: MarketInfo }) {
  const { pack } = info;
  const range = (value: [number, number] | null) => value ? value.map((item) => usd.format(item)).join("–") : "Chưa rõ";
  return <div className="panel">
    <p>Ngôn ngữ: {pack.languages.map(({ code }) => `${languageNames.of(code) ?? code} (${code})`).join(", ")}</p>
    <p>Múi giờ khán giả mặc định: {pack.defaultTimezone}</p>
    <p><strong>RPM ước tính</strong> · <span className="badge">{freshness[info.freshness]}</span></p>
    <p>YouTube video dài {range(pack.rpmUsd.youtubeLong)} · Shorts {range(pack.rpmUsd.youtubeShorts)} / 1.000 lượt xem</p>
    <details>
      <summary>Nền tảng và kiếm tiền (ước tính)</summary>
      <ul>{Object.entries(pack.platforms).map(([key, platform]) => (
        <li key={key}>{platformLabels[key as keyof typeof platformLabels]}: {availability(platform.available)}</li>
      ))}</ul>
      <ul>{Object.entries(pack.monetization).map(([key, value]) => <li key={key}>{programLabels[key] ?? key}: {availability(value)}</li>)}</ul>
    </details>
  </div>;
}

export function MarketSettings({ profile }: { profile: ProfileDetail }) {
  const current = profile.market ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const selected = draft ?? current;
  const info = useMarketInfo(selected);
  const update = useUpdateProfile();
  const cache = useQueryClient();
  const preview = useQuery({
    queryKey: ["market-preview", profile.id, selected, profile.updatedAt],
    enabled: draft !== null && Boolean(selected),
    queryFn: () => apiRequest<{ changes: Change[]; previewToken: string }>(
      `/profiles/${profile.id}/market-defaults?code=${encodeURIComponent(selected)}`,
    ),
  });
  const [choices, setChoices] = useState<Partial<Record<MarketDefaultField, boolean>>>({});
  const [saved, setSaved] = useState(false);
  const apply = useMutation({
    mutationFn: async () => {
      if (!selected) return update.mutateAsync({ id: profile.id, input: { market: null } });
      const fields = (preview.data?.changes ?? [])
        .filter(({ field, recentlyEdited }) => choices[field] ?? !recentlyEdited).map(({ field }) => field);
      return apiRequest<ProfileDetail>(`/profiles/${profile.id}/apply-market-defaults`, {
        method: "POST", body: JSON.stringify({ code: selected, fields, previewToken: preview.data?.previewToken }),
      });
    },
    onError: async (error) => {
      if (error instanceof ApiRequestError && error.code === "MARKET_PREVIEW_CHANGED") {
        setChoices({});
        await preview.refetch();
      }
    },
    onSuccess: async (updated) => {
      cache.setQueryData(profileKeys.detail(profile.id), updated);
      setDraft(null);
      setSaved(true);
      await Promise.all([
        cache.invalidateQueries({ queryKey: profileKeys.all }),
        cache.invalidateQueries({ queryKey: ["accounts", "all"] }),
        ...profile.accounts.map((account) => cache.invalidateQueries({ queryKey: accountConnectionKeys.detail(profile.id, account.id) })),
      ]);
    },
  });
  return <section className="panel form-panel" aria-label="Thị trường mục tiêu">
    <h2>Thị trường mục tiêu</h2>
    <MarketPicker value={selected} onChange={(code) => {
      setSaved(false);
      setChoices({});
      apply.reset();
      setDraft(code === current ? null : code);
    }} />
    {current && draft === null && <button type="button" className="button button-secondary" onClick={() => {
      setSaved(false);
      setChoices({});
      apply.reset();
      setDraft(current);
    }}>Xem mặc định thị trường</button>}
    {draft === null && info.data && <MarketInfoCard info={info.data} />}
    {draft === null && info.isError && <p role="alert">{info.error.message}</p>}
    {saved && <p role="status">Đã lưu thị trường mục tiêu.</p>}
    <Modal open={draft !== null} title="Áp dụng mặc định thị trường" onClose={() => {
      if (!apply.isPending) setDraft(null);
    }}>
      {!selected && <p>Bỏ chọn thị trường cho các dự án mới.</p>}
      {selected && info.data && <MarketInfoCard info={info.data} />}
      {selected && preview.isPending && <p>Đang tải đề xuất…</p>}
      {preview.isError && <p role="alert">{preview.error.message}</p>}
      {selected && preview.data?.changes.length === 0 && <p>Chỉ cập nhật lựa chọn thị trường.</p>}
      {selected && preview.data?.changes.map(({ field, from, to, recentlyEdited }) => <label key={field} className="form-field">
        <span>
          <input type="checkbox" checked={choices[field] ?? !recentlyEdited}
            onChange={(event) => setChoices((old) => ({ ...old, [field]: event.target.checked }))} />
          {" "}{fieldLabels[field]} · {showValue(from)} → {showValue(to)}
        </span>
        {recentlyEdited && <small>Đã sửa thủ công trong 30 ngày qua</small>}
      </label>)}
      {apply.isError && <p role="alert">{apply.error.message}</p>}
      <div className="dialog-actions">
        <button type="button" className="button button-secondary" onClick={() => setDraft(null)} disabled={apply.isPending}>Hủy</button>
        <button type="button" className="button button-primary" onClick={() => apply.mutate()}
          disabled={apply.isPending || Boolean(selected && (!preview.data || preview.isFetching))}>Áp dụng</button>
      </div>
    </Modal>
  </section>;
}

export function MarketLanguageFields({ pack, value, onChange }: {
  pack: MarketPack; value: string; onChange: (language: string) => void;
}) {
  const [other, setOther] = useState(false);
  return <>
    <label className="form-field">
      <span>Ngôn ngữ</span>
      <select value={other ? "other" : value || pack.languages[0]!.code} onChange={(event) => {
        const choice = event.target.value;
        setOther(choice === "other");
        onChange(choice === "other" ? "" : choice);
      }}>
        {pack.languages.map(({ code }) => <option key={code} value={code}>{languageNames.of(code) ?? code}</option>)}
        <option value="other">Khác</option>
      </select>
    </label>
    {other && <label className="form-field">
      <span>Mã ngôn ngữ khác</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} required pattern="[A-Za-z]{2,8}([_-][A-Za-z0-9]{2,8})*" />
    </label>}
  </>;
}
