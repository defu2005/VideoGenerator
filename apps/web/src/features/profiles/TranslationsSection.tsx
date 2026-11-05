import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProfileDetail, ProfileTranslationTarget, TranslationMode } from "@vg/shared";
import { updateProfile } from "../../services/profilesApi";
import { profileKeys } from "../../hooks/useProfiles";

export function TranslationsSection({ profile }: { profile: ProfileDetail }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ProfileTranslationTarget[]>(profile.translations ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updateProfile(profile.id, { translations: rows }),
    onSuccess: async () => {
      setMessage("Đã lưu đa ngôn ngữ.");
      await queryClient.invalidateQueries({ queryKey: profileKeys.detail(profile.id) });
    },
  });

  function update(index: number, patch: Partial<ProfileTranslationTarget>) {
    setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  return (
    <section className="panel form-stack" aria-label="Đa ngôn ngữ">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LANGUAGES</p>
          <h2>Đa ngôn ngữ</h2>
        </div>
      </div>
      {rows.map((row, index) => (
        <fieldset key={`${row.language}-${index}`} className="form-stack">
          <label>
            Ngôn ngữ
            <input aria-label={`Ngôn ngữ bản dịch ${index + 1}`} value={row.language} onChange={(event) => update(index, { language: event.target.value })} />
          </label>
          <label>
            Giọng
            <input aria-label={`Giọng bản dịch ${index + 1}`} value={row.voice ?? ""} onChange={(event) => update(index, { voice: event.target.value || undefined })} />
          </label>
          <label>
            Cách làm
            <select
              aria-label={`Cách làm bản dịch ${index + 1}`}
              value={row.mode}
              onChange={(event) => update(index, { mode: event.target.value as TranslationMode })}
            >
              <option value="dub">Lồng tiếng</option>
              <option value="subtitles_only">Chỉ phụ đề</option>
            </select>
          </label>
          {profile.accounts.map((account) => (
            <label className="field-checkbox" key={account.id}>
              <input
                type="checkbox"
                checked={row.accountIds.includes(account.id)}
                onChange={(event) => {
                  const accountIds = event.target.checked
                    ? [...row.accountIds, account.id]
                    : row.accountIds.filter((id) => id !== account.id);
                  update(index, { accountIds });
                }}
              />
              {account.displayName}
            </label>
          ))}
          <button className="button" type="button" onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}>Xóa ngôn ngữ</button>
        </fieldset>
      ))}
      <div className="button-row">
        <button
          className="button"
          type="button"
          onClick={() => setRows([...rows, { language: "en", accountIds: [], mode: "dub" }])}
        >
          Thêm ngôn ngữ
        </button>
        <button className="button button-primary" type="button" disabled={save.isPending} onClick={() => void save.mutate()}>
          Lưu đa ngôn ngữ
        </button>
      </div>
      {message && <p>{message}</p>}
    </section>
  );
}
