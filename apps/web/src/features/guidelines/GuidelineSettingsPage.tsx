import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GUIDELINE_DISCLAIMER,
  type GuidelinePack,
  type GuidelineProfile,
  type GuidelineProfiles,
  type GuidelineRule,
  type GuidelineTarget,
} from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { getGuidelinePacks, getGuidelineProfiles, saveGuidelinePacks, saveGuidelineProfiles } from "../../services/guidelinesApi";

const TARGETS: GuidelineTarget[] = ["script", "visuals", "music", "subtitles", "metadata"];

function copyPack(pack: GuidelinePack, taken: Set<string>): GuidelinePack {
  const base = `${pack.id}_copy`.slice(0, 48);
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`.slice(0, 60);
  return { ...pack, id, name: `${pack.name} (bản sao)`.slice(0, 80), basedOn: pack.basedOn ?? pack.id, rules: pack.rules.map((rule) => ({ ...rule })) };
}

export function GuidelineSettingsPage() {
  const queryClient = useQueryClient();
  const packsQuery = useQuery({ queryKey: ["guideline-packs"], queryFn: getGuidelinePacks });
  const profilesQuery = useQuery({ queryKey: ["guideline-profiles"], queryFn: getGuidelineProfiles });
  const [custom, setCustom] = useState<GuidelinePack[]>([]);
  const [profiles, setProfiles] = useState<GuidelineProfiles>({ profiles: [], defaultProfileId: null });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (packsQuery.data) setCustom(packsQuery.data.custom);
  }, [packsQuery.data]);
  useEffect(() => {
    if (profilesQuery.data) setProfiles(profilesQuery.data);
  }, [profilesQuery.data]);

  const savePacks = useMutation({
    mutationFn: () => saveGuidelinePacks(custom),
    onSuccess: (data) => {
      queryClient.setQueryData(["guideline-packs"], data);
      setMessage("Đã lưu gói định hướng.");
      setError("");
    },
    onError: (reason: Error) => setError(reason.message),
  });
  const saveProfiles = useMutation({
    mutationFn: () => saveGuidelineProfiles(profiles),
    onSuccess: (data) => {
      queryClient.setQueryData(["guideline-profiles"], data);
      setMessage("Đã lưu hồ sơ kênh.");
      setError("");
    },
    onError: (reason: Error) => setError(reason.message),
  });

  if (packsQuery.isPending || profilesQuery.isPending) return <Spinner label="Đang tải định hướng nội dung" />;
  if (packsQuery.isError || profilesQuery.isError) {
    return <ErrorState message="Không tải được định hướng nội dung" onRetry={() => { void packsQuery.refetch(); void profilesQuery.refetch(); }} />;
  }

  const builtIn = packsQuery.data.builtIn;
  function updatePack(id: string, patch: Partial<GuidelinePack>) {
    setCustom((current) => current.map((pack) => pack.id === id ? { ...pack, ...patch } : pack));
  }
  function updateRule(packId: string, index: number, patch: Partial<GuidelineRule>) {
    setCustom((current) => current.map((pack) => pack.id === packId ? {
      ...pack,
      rules: pack.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    } : pack));
  }

  return (
    <section className="guideline-settings">
      <header>
        <p className="eyebrow">CÀI ĐẶT</p>
        <h1>Định hướng nội dung</h1>
        <p>{GUIDELINE_DISCLAIMER}</p>
      </header>
      {message && <p role="status">{message}</p>}
      {error && <p className="request-error" role="alert">{error}</p>}
      <div className="panel guideline-pack-list">
        <h2>Gói có sẵn</h2>
        <ul>
          {builtIn.map((pack) => (
            <li key={pack.id}>
              <strong>{pack.name}</strong> · {pack.kind} · {pack.rules.length} quy tắc · rà soát {pack.reviewedAt}
              <button className="text-button" type="button" onClick={() => setCustom((current) => [...current, copyPack(pack, new Set(current.map((item) => item.id)))])}>Nhân bản</button>
            </li>
          ))}
        </ul>
        <h2>Gói của bạn</h2>
        {custom.length === 0 && <p className="field-hint">Chưa có bản sao. Nhân bản một gói có sẵn để sửa.</p>}
        {custom.map((pack) => (
          <article key={pack.id} className="guideline-pack-editor">
            <label className="form-field"><span>Tên</span>
              <input aria-label={`Tên gói ${pack.id}`} value={pack.name} maxLength={80} onChange={(event) => updatePack(pack.id, { name: event.target.value })} />
            </label>
            <label className="form-field"><span>Mô tả</span>
              <input aria-label={`Mô tả gói ${pack.id}`} value={pack.description} maxLength={400} onChange={(event) => updatePack(pack.id, { description: event.target.value })} />
            </label>
            <div className="guideline-params">
              <label className="form-field"><span>Thời lượng tối đa (giây)</span>
                <input aria-label={`Thời lượng tối đa ${pack.id}`} type="number" min={1} value={pack.params?.maxDurationSec ?? ""} onChange={(event) => updatePack(pack.id, { params: { ...pack.params, ...(event.target.value ? { maxDurationSec: Number(event.target.value) } : {}) } })} />
              </label>
              <label className="form-field"><span>Hook trong (giây)</span>
                <input aria-label={`Hook ${pack.id}`} type="number" min={0.1} step={0.1} value={pack.params?.hookWithinSec ?? ""} onChange={(event) => updatePack(pack.id, { params: { ...pack.params, ...(event.target.value ? { hookWithinSec: Number(event.target.value) } : {}) } })} />
              </label>
            </div>
            {pack.rules.map((rule, index) => (
              <div key={`${pack.id}-${rule.id}`} className="guideline-rule-editor">
                <input aria-label={`Nội dung quy tắc ${rule.id}`} value={rule.text} maxLength={400} onChange={(event) => updateRule(pack.id, index, { text: event.target.value })} />
                <select aria-label={`Mức ${rule.id}`} value={rule.severity} onChange={(event) => updateRule(pack.id, index, { severity: event.target.value as GuidelineRule["severity"] })}>
                  <option value="MUST">MUST</option>
                  <option value="SHOULD">SHOULD</option>
                  <option value="TIP">TIP</option>
                </select>
                <div role="group" aria-label={`Áp dụng ${rule.id}`}>
                  {TARGETS.map((target) => (
                    <label key={target} className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={rule.appliesTo.includes(target)}
                        onChange={() => {
                          const appliesTo = rule.appliesTo.includes(target)
                            ? rule.appliesTo.filter((item) => item !== target)
                            : [...rule.appliesTo, target];
                          if (appliesTo.length) updateRule(pack.id, index, { appliesTo });
                        }}
                      />
                      {target}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <button className="text-button" type="button" onClick={() => setCustom((current) => current.filter((item) => item.id !== pack.id))}>Xoá gói</button>
          </article>
        ))}
        <button className="button button-primary" type="button" disabled={savePacks.isPending} onClick={() => savePacks.mutate()}>Lưu gói</button>
      </div>
      <ProfileEditor profiles={profiles} onChange={setProfiles} onSave={() => saveProfiles.mutate()} pending={saveProfiles.isPending} />
    </section>
  );
}

function ProfileEditor({
  profiles,
  onChange,
  onSave,
  pending,
}: {
  profiles: GuidelineProfiles;
  onChange: (profiles: GuidelineProfiles) => void;
  onSave: () => void;
  pending: boolean;
}) {
  function update(id: string, patch: Partial<GuidelineProfile>) {
    onChange({ ...profiles, profiles: profiles.profiles.map((profile) => profile.id === id ? { ...profile, ...patch } : profile) });
  }
  return (
    <div className="panel guideline-profiles">
      <h2>Hồ sơ kênh</h2>
      <p className="field-hint">Hồ sơ mặc định được gắn khi tạo dự án mới nếu dự án chưa chọn định hướng.</p>
      {profiles.profiles.map((profile) => (
        <article key={profile.id}>
          <label className="form-field"><span>Tên hồ sơ</span>
            <input aria-label={`Tên hồ sơ ${profile.id}`} value={profile.name} onChange={(event) => update(profile.id, { name: event.target.value })} />
          </label>
          <label className="checkbox-field">
            <input
              type="radio"
              name="default-guideline-profile"
              checked={profiles.defaultProfileId === profile.id}
              onChange={() => onChange({ ...profiles, defaultProfileId: profile.id })}
            />
            Hồ sơ mặc định
          </label>
          <label className="form-field"><span>Quy tắc riêng</span>
            <textarea
              aria-label={`Quy tắc hồ sơ ${profile.id}`}
              value={profile.guidelines.customRules.join("\n")}
              onChange={(event) => update(profile.id, {
                guidelines: {
                  ...profile.guidelines,
                  customRules: event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20),
                },
              })}
            />
          </label>
          <button className="text-button" type="button" onClick={() => onChange({
            profiles: profiles.profiles.filter((item) => item.id !== profile.id),
            defaultProfileId: profiles.defaultProfileId === profile.id ? null : profiles.defaultProfileId,
          })}>Xoá hồ sơ</button>
        </article>
      ))}
      <button className="button button-secondary" type="button" onClick={() => {
        const id = `kenh_${profiles.profiles.length + 1}`;
        onChange({
          ...profiles,
          profiles: [...profiles.profiles, { id, name: "Hồ sơ mới", guidelines: { platformPack: "auto", customRules: [] } }],
        });
      }}>Thêm hồ sơ</button>
      <button className="button button-primary" type="button" disabled={pending} onClick={onSave}>Lưu hồ sơ</button>
    </div>
  );
}
