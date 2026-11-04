import { useQuery } from "@tanstack/react-query";
import {
  GUIDELINE_DISCLAIMER,
  suggestGuidelinePacks,
  type GuidelinePack,
  type GuidelineSettingsInput,
  type ProjectSettings,
} from "@vg/shared";
import { getGuidelinePacks } from "../../services/guidelinesApi";

export type GuidelineDraft = {
  platformPack: string;
  channelsChosen: boolean;
  channelPacks: string[];
  customRules: string;
  strictness: "" | "REMIND" | "FILTER";
};

export const DEFAULT_GUIDELINE_DRAFT: GuidelineDraft = {
  platformPack: "auto",
  channelsChosen: false,
  channelPacks: [],
  customRules: "",
  strictness: "",
};

type BriefHint = Pick<ProjectSettings, "platform" | "style" | "tone" | "audience">;

export function guidelineDraftFromSettings(settings: Pick<ProjectSettings, "guidelines">): GuidelineDraft {
  const guidelines = settings.guidelines;
  if (!guidelines) return DEFAULT_GUIDELINE_DRAFT;
  return {
    platformPack: guidelines.platformPack === null ? "none" : guidelines.platformPack || "auto",
    channelsChosen: guidelines.channelPacks !== undefined,
    channelPacks: guidelines.channelPacks ?? [],
    customRules: guidelines.customRules.join("\n"),
    strictness: guidelines.strictness ?? "",
  };
}

export function guidelineSettingsFromDraft(draft: GuidelineDraft): GuidelineSettingsInput | undefined {
  const untouched = draft.platformPack === "auto"
    && !draft.channelsChosen
    && draft.customRules.trim() === ""
    && draft.strictness === "";
  if (untouched) return undefined;
  return {
    platformPack: draft.platformPack === "none" ? null : draft.platformPack,
    ...(draft.channelsChosen ? { channelPacks: draft.channelPacks.slice(0, 3) } : {}),
    customRules: draft.customRules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20),
    ...(draft.strictness ? { strictness: draft.strictness } : {}),
  };
}

export function GuidelineFieldset({
  draft,
  brief,
  onChange,
}: {
  draft: GuidelineDraft;
  brief: BriefHint;
  onChange: (draft: GuidelineDraft) => void;
}) {
  const packs = useQuery({ queryKey: ["guideline-packs"], queryFn: getGuidelinePacks });
  const all = [...(packs.data?.builtIn ?? []), ...(packs.data?.custom ?? [])];
  const platformPacks = all.filter((pack) => pack.kind === "PLATFORM");
  const channelPacks = all.filter((pack) => pack.kind === "CHANNEL");
  const suggested = suggestGuidelinePacks(brief);
  const selectedChannels = draft.channelsChosen ? draft.channelPacks : suggested;
  const platformId = draft.platformPack === "auto"
    ? (brief.platform === "custom" ? null : brief.platform)
    : draft.platformPack === "none" ? null : draft.platformPack;
  const visible = all.filter((pack) => pack.id === platformId || selectedChannels.includes(pack.id));

  function toggleChannel(id: string) {
    const current = draft.channelsChosen ? draft.channelPacks : suggested;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 3);
    onChange({ ...draft, channelsChosen: true, channelPacks: next });
  }

  return (
    <fieldset className="guideline-fieldset">
      <legend>Định hướng nội dung</legend>
      <label className="form-field">
        <span>Gói nền tảng</span>
        <select
          aria-label="Gói nền tảng"
          value={draft.platformPack}
          onChange={(event) => onChange({ ...draft, platformPack: event.target.value })}
        >
          <option value="auto">Tự động theo nền tảng</option>
          <option value="none">Không dùng gói nền tảng</option>
          {platformPacks.map((pack) => (
            <option key={pack.id} value={pack.id}>{pack.name}{pack.basedOn ? " (bản sao)" : ""}</option>
          ))}
        </select>
      </label>
      <div className="guideline-channels" role="group" aria-label="Gói kênh">
        {channelPacks.map((pack) => {
          const checked = selectedChannels.includes(pack.id);
          const disabled = !checked && selectedChannels.length >= 3;
          return (
            <label key={pack.id} className="checkbox-field">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggleChannel(pack.id)}
              />
              {pack.name}
            </label>
          );
        })}
      </div>
      <label className="form-field">
        <span>Quy tắc riêng (mỗi dòng một quy tắc, tối đa 20)</span>
        <textarea
          aria-label="Quy tắc riêng"
          rows={3}
          maxLength={6000}
          value={draft.customRules}
          onChange={(event) => onChange({ ...draft, customRules: event.target.value })}
        />
      </label>
      <label className="form-field">
        <span>Mức áp dụng</span>
        <select
          aria-label="Mức áp dụng"
          value={draft.strictness}
          onChange={(event) => onChange({ ...draft, strictness: event.target.value as GuidelineDraft["strictness"] })}
        >
          <option value="">Tự động</option>
          <option value="REMIND">Chỉ nhắc</option>
          <option value="FILTER">Nhắc + lọc</option>
        </select>
      </label>
      <details className="guideline-rules">
        <summary>Quy tắc của các gói đang chọn ({visible.reduce((sum, pack) => sum + pack.rules.length, 0)})</summary>
        {visible.map((pack) => (
          <PackRules key={pack.id} pack={pack} />
        ))}
        <p className="field-hint">{packs.data?.disclaimer ?? GUIDELINE_DISCLAIMER}</p>
      </details>
      {packs.isError && <small className="field-error">Không tải được danh sách gói định hướng.</small>}
    </fieldset>
  );
}

function PackRules({ pack }: { pack: GuidelinePack }) {
  return (
    <section>
      <h3>{pack.name} <small>rà soát {pack.reviewedAt}</small></h3>
      <ul>
        {pack.rules.map((rule) => (
          <li key={rule.id}>
            <span className={`severity-badge severity-${rule.severity}`}>{rule.severity}</span>
            {rule.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
