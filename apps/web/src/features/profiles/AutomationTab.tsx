import { useEffect, useState, type FormEvent } from "react";
import type { ProfileAutomation, ProfileDetail } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { useProfileAutomation, useSaveProfileAutomation } from "../../hooks/useAutomation";

function timesToText(times: string[]): string {
  return times.join(", ");
}

function parseTimes(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function AutomationTab({ profile }: { profile: ProfileDetail }) {
  const view = useProfileAutomation(profile.id);
  const save = useSaveProfileAutomation(profile.id);
  const [draft, setDraft] = useState<ProfileAutomation>(profile.automation);
  const [timesText, setTimesText] = useState(timesToText(profile.automation.publishTimes));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(profile.automation);
    setTimesText(timesToText(profile.automation.publishTimes));
  }, [profile.automation]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await save.mutateAsync({
        automation: {
          ...draft,
          publishTimes: parseTimes(timesText),
        },
      });
      setMessage("Đã lưu lịch tự động.");
      void view.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được");
    }
  }

  if (view.isPending) return <Spinner label="Đang tải lịch tự động" />;
  if (view.isError) {
    return (
      <ErrorState
        message={view.error instanceof Error ? view.error.message : "Lỗi"}
        onRetry={() => void view.refetch()}
      />
    );
  }

  const data = view.data!;

  return (
    <div className="page-stack">
      <form className="panel form-stack" onSubmit={(event) => void onSubmit(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">LỊCH</p>
            <h2>Tự động sản xuất & đăng</h2>
          </div>
        </div>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          Bật tự động cho hồ sơ này
        </label>
        <label>
          Múi giờ
          <input
            value={draft.timezone}
            onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
          />
        </label>
        <label>
          Số video / ngày (1–10)
          <input
            type="number"
            min={1}
            max={10}
            value={draft.videosPerDay}
            onChange={(event) => setDraft({ ...draft, videosPerDay: Number(event.target.value) || 1 })}
          />
        </label>
        <label>
          Giờ đăng (HH:mm, cách nhau bằng dấu phẩy)
          <input value={timesText} onChange={(event) => setTimesText(event.target.value)} placeholder="19:00" />
        </label>
        <label>
          Lead time (giờ trước giờ đăng)
          <input
            type="number"
            min={0}
            max={72}
            value={draft.leadTimeHours}
            onChange={(event) => setDraft({ ...draft, leadTimeHours: Number(event.target.value) || 0 })}
          />
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={draft.autoSuggest}
            onChange={(event) => setDraft({ ...draft, autoSuggest: event.target.checked })}
          />
          Tự gợi ý chủ đề khi sắp hết hàng đợi
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={draft.autoApproveTopics}
            onChange={(event) => setDraft({ ...draft, autoApproveTopics: event.target.checked })}
          />
          Tự duyệt chủ đề do AI gợi ý
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={draft.autoShorts}
            onChange={(event) => setDraft({ ...draft, autoShorts: event.target.checked })}
          />
          Tự cắt Shorts từ video dài
        </label>
        <label>
          Số Shorts mỗi video dài (1–8)
          <input
            aria-label="Số Shorts mỗi video dài"
            type="number"
            min={1}
            max={8}
            value={draft.shortsPerVideo}
            disabled={!draft.autoShorts}
            onChange={(event) => setDraft({ ...draft, shortsPerVideo: Math.min(8, Math.max(1, Number(event.target.value) || 1)) })}
          />
        </label>
        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "Đang lưu…" : "Lưu lịch"}
          </button>
          {message && <span className="form-hint">{message}</span>}
        </div>
      </form>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">7 NGÀY TỚI</p>
            <h2>Slot đăng</h2>
            <p className="page-subtitle">
              Hôm nay đã sản xuất {data.todayCount}/{draft.videosPerDay} · {data.approvedCount} chủ đề đã duyệt
            </p>
          </div>
        </div>
        <div className="automation-slot-list">
          {data.slots.map((slot) => (
            <div key={slot.publishAt} className="automation-slot-row">
              <time dateTime={slot.publishAt}>
                {new Date(slot.publishAt).toLocaleString("vi-VN", { timeZone: draft.timezone })}
              </time>
              <span>{slot.topic?.topic ?? "— trống —"}</span>
              <span>{slot.productionStatus ?? "—"}</span>
              <span>{slot.publicationStatus ?? "—"}</span>
            </div>
          ))}
        </div>
      </section>

      {data.logs.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <div><p className="eyebrow">NHẬT KÝ</p><h2>Gần đây</h2></div>
          </div>
          <ul className="recent-error-list">
            {data.logs.slice(0, 10).map((log) => (
              <li key={log.id}>
                <strong>{log.level}</strong>
                <p>{log.message}</p>
                <time dateTime={log.at}>{new Date(log.at).toLocaleString("vi-VN")}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
