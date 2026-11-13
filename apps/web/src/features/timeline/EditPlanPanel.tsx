import { useState } from "react";
import {
  EDIT_PRESET_LABELS,
  EDIT_PRESETS,
  MOTION_LABELS,
  MOTION_PRESETS,
  SUBTITLE_STYLE_LABELS,
  SUBTITLE_STYLES,
  TRANSITION_LABELS,
  TRANSITION_TYPES,
  clampTransitionDuration,
  type EditPlan,
  type MotionPreset,
  MOTION_TEMPLATES,
  type Timeline,
  type TimelineGraphic,
  type TransitionType,
} from "@vg/shared";
import { useScenes } from "../../hooks/useScenes";
import { generateEditPlan, previewEditWindow, saveEditPlan, saveGraphic } from "../../services/timelineApi";

export function subtitlePreviewClass(style: string): string {
  return `subtitle-preview subtitle-preview-${style}`;
}

export function EditPlanPanel({
  projectId,
  timeline,
  onSaved,
}: {
  projectId: string;
  timeline: Timeline;
  onSaved: (timeline: Timeline) => void;
}) {
  const plan = timeline.editPlan;
  const scenes = useScenes(projectId);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [style, setStyle] = useState(plan?.subtitleStyle ?? "karaoke");

  async function run(action: () => Promise<{ timeline: Timeline }>, ok: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await action();
      onSaved(result.timeline);
      setStyle(result.timeline.editPlan?.subtitleStyle ?? style);
      setMessage(ok);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được kế hoạch dựng");
    } finally {
      setBusy(false);
    }
  }

  function withPlan(next: EditPlan) {
    return run(() => saveEditPlan(projectId, next), "Đã lưu kế hoạch dựng.");
  }

  const base = plan ?? {
    preset: "story" as const,
    transitions: [],
    motions: [],
    emphasis: [],
    subtitleStyle: style,
    source: "user" as const,
  };

  return (
    <section className="panel" aria-label="Kế hoạch dựng">
      <h3>Kế hoạch dựng</h3>
      {message && <p className="field-hint">{message}</p>}
      <div className="form-row">
        <label className="form-field">
          <span>Phụ đề</span>
          <select aria-label="Kiểu phụ đề" value={style} onChange={(event) => {
            const subtitleStyle = event.target.value as EditPlan["subtitleStyle"];
            setStyle(subtitleStyle);
            if (plan) void withPlan({ ...plan, subtitleStyle, source: "user" });
          }}>
            {SUBTITLE_STYLES.map((item) => <option key={item} value={item}>{SUBTITLE_STYLE_LABELS[item]}</option>)}
          </select>
        </label>
        <div className={subtitlePreviewClass(style)} aria-label="Xem thử kiểu phụ đề">
          <span>Từ đang đọc</span>
        </div>
      </div>
      <ul>
        {timeline.scenes.slice(0, -1).map((scene) => {
          const row = plan?.transitions.find((item) => item.afterSceneId === scene.sceneId) ?? scene.transitionOut;
          const current = row?.type ?? "cut";
          const duration = current === "cut" ? 0 : row?.durationSec || 0.4;
          return (
            <li key={scene.sceneId}>
              <span>{scene.label}</span>
              <select
                aria-label={`Chuyển cảnh sau ${scene.label}`}
                value={current}
                onChange={(event) => {
                  const type = event.target.value as TransitionType;
                  const transitions = [
                    ...base.transitions.filter((item) => item.afterSceneId !== scene.sceneId),
                    { afterSceneId: scene.sceneId, type, durationSec: type === "cut" ? 0 : clampTransitionDuration(duration || 0.4) },
                  ];
                  void withPlan({ ...base, transitions, source: "user" });
                }}
              >
                {TRANSITION_TYPES.map((type) => <option key={type} value={type}>{TRANSITION_LABELS[type]}</option>)}
              </select>
              <label>
                giây
                <input
                  aria-label={`Thời lượng chuyển cảnh sau ${scene.label}`}
                  type="number"
                  min={0.25}
                  max={0.8}
                  step={0.05}
                  disabled={current === "cut" || busy}
                  value={duration}
                  onChange={(event) => {
                    const next = clampTransitionDuration(Number(event.target.value));
                    const transitions = [
                      ...base.transitions.filter((item) => item.afterSceneId !== scene.sceneId),
                      { afterSceneId: scene.sceneId, type: current, durationSec: next },
                    ];
                    void withPlan({ ...base, transitions, source: "user" });
                  }}
                />
              </label>
            </li>
          );
        })}
      </ul>
      <ul>
        {timeline.scenes.map((scene) => {
          const current = plan?.motions.find((item) => item.sceneId === scene.sceneId)?.preset ?? "static";
          return (
            <li key={`motion-${scene.sceneId}`}>
              <span>{scene.label}</span>
              <select
                aria-label={`Chuyển động ${scene.label}`}
                value={current}
                onChange={(event) => {
                  const preset = event.target.value as MotionPreset;
                  const motions = [
                    ...base.motions.filter((item) => item.sceneId !== scene.sceneId),
                    { sceneId: scene.sceneId, preset },
                  ];
                  void withPlan({ ...base, motions, source: "user" });
                }}
              >
                {MOTION_PRESETS.map((preset) => <option key={preset} value={preset}>{MOTION_LABELS[preset]}</option>)}
              </select>
            </li>
          );
        })}
      </ul>
      {(scenes.data?.scenes ?? []).map((scene) => {
        const words = scene.narration.trim().split(/\s+/u).filter(Boolean);
        if (words.length === 0) return null;
        return (
          <p key={scene.id}>
            <span>{scene.label}: </span>
            {words.map((word, index) => {
              const marked = (plan?.emphasis ?? []).some((item) => item.sceneId === scene.id && index >= item.wordIndexStart && index <= item.wordIndexEnd);
              return (
                <button
                  key={`${scene.id}-${index}`}
                  type="button"
                  className={marked ? "text-button is-emphasis" : "text-button"}
                  aria-pressed={marked}
                  onClick={() => {
                    const emphasis = marked
                      ? base.emphasis.filter((item) => !(item.sceneId === scene.id && index >= item.wordIndexStart && index <= item.wordIndexEnd))
                      : [...base.emphasis, { sceneId: scene.id, wordIndexStart: index, wordIndexEnd: index, effects: ["callout" as const], calloutText: word.slice(0, 24) }];
                    void withPlan({ ...base, emphasis, source: "user" });
                  }}
                >
                  {word}
                </button>
              );
            })}
          </p>
        );
      })}
      {plan && plan.emphasis.length > 0 && (
        <p>
          Nhấn mạnh: {plan.emphasis.map((item) => item.calloutText || `${item.wordIndexStart}`).join(", ")}
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void withPlan({ ...plan, emphasis: plan.emphasis.slice(1), source: "user" })}
          >
            Bỏ nhấn mạnh
          </button>
        </p>
      )}
      <div className="timeline-header-actions">
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => void run(() => generateEditPlan(projectId), "Đã tạo kế hoạch dựng.")}>
          Tạo kế hoạch dựng bằng AI
        </button>
        <button className="button button-secondary" type="button" disabled={busy || timeline.scenes.length === 0} onClick={() => void previewEditWindow(projectId, timeline.scenes[0].sceneId).then((window) => {
          const graphics = window.graphics?.map((graphic) => graphic.templateId).join(", ");
          setMessage(`Xem nhanh 10 giây từ ${window.startSec.toFixed(1)}s đến ${window.endSec.toFixed(1)}s.${graphics ? ` Đồ họa: ${graphics}.` : ""}`);
        })}>
          Xem nhanh 10 giây
        </button>
      </div>
      <p className="field-hint">Preset trên hồ sơ: {EDIT_PRESETS.map((item) => EDIT_PRESET_LABELS[item]).join(", ")}.</p>
      <div className="timeline-lane" aria-label="Đồ họa">
        {(timeline.graphics ?? []).map((graphic) => {
          const total = Math.max(timeline.totalDurationSec, 0.1);
          const left = Math.min(100, (graphic.startSec / total) * 100);
          const width = Math.max(8, Math.min(100 - left, (graphic.durationSec / total) * 100));
          return (
            <button
              key={graphic.id}
              type="button"
              className="timeline-block"
              style={{ left: `${left}%`, width: `${width}%` }}
              onClick={() => setSelectedId(graphic.id)}
            >
              {graphic.templateId}
            </button>
          );
        })}
      </div>
      <button type="button" className="button button-secondary" onClick={() => setSelectedId("new")}>Thêm đồ họa</button>
      {selectedId && (
        <GraphicForm
          graphic={selectedId === "new" ? null : (timeline.graphics ?? []).find((item) => item.id === selectedId) ?? null}
          onSave={async (body) => {
            const saved = await saveGraphic(projectId, body);
            onSaved(saved.timeline);
            setSelectedId(null);
            setMessage("Đã lưu đồ họa.");
          }}
        />
      )}
      <iframe
        title="Xem trước đồ họa"
        sandbox="allow-scripts"
        src={previewSrc(selectedId, timeline)}
      />
    </section>
  );
}

function previewSrc(selectedId: string | null, timeline: Timeline): string {
  const graphic = selectedId && selectedId !== "new"
    ? (timeline.graphics ?? []).find((item) => item.id === selectedId)
    : undefined;
  const template = graphic?.templateId ?? "title_card";
  const variables = graphic?.variables ?? { title: "Xem trước" };
  return `/api/motion/preview?template=${template}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
}

function GraphicForm({
  graphic,
  onSave,
}: {
  graphic: TimelineGraphic | null;
  onSave: (body: {
    id?: string;
    remove?: boolean;
    templateId: string;
    startSec: number;
    durationSec: number;
    variables: Record<string, string | number>;
  }) => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState(graphic?.templateId ?? "title_card");
  const [startSec, setStartSec] = useState(graphic?.startSec ?? 0);
  const [durationSec, setDurationSec] = useState(graphic?.durationSec ?? 3);
  const [variables, setVariables] = useState<Record<string, string | number>>(graphic?.variables ?? {});
  const spec = MOTION_TEMPLATES.find((item) => item.id === templateId);
  return (
    <form className="panel" onSubmit={(event) => {
      event.preventDefault();
      void onSave({ id: graphic?.id, templateId, startSec, durationSec, variables });
    }}>
      <label className="form-field">
        <span>Mẫu</span>
        <select aria-label="Mẫu đồ họa" value={templateId} onChange={(event) => setTemplateId(event.target.value as TimelineGraphic["templateId"])}>
          {MOTION_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.nameVi}</option>)}
        </select>
      </label>
      <label className="form-field">
        <span>Bắt đầu (giây)</span>
        <input aria-label="Thời điểm đồ họa" type="number" min={0} step={0.1} value={startSec} onChange={(event) => setStartSec(Number(event.target.value))} />
      </label>
      <label className="form-field">
        <span>Thời lượng (giây)</span>
        <input aria-label="Thời lượng đồ họa" type="number" min={0.2} step={0.1} value={durationSec} onChange={(event) => setDurationSec(Number(event.target.value))} />
      </label>
      {spec?.variables.map((variable) => (
        <label key={variable.name} className="form-field">
          <span>{variable.name}</span>
          <input
            aria-label={variable.name}
            maxLength={variable.maxLength}
            value={String(variables[variable.name] ?? variable.default)}
            onChange={(event) => setVariables((current) => ({
              ...current,
              [variable.name]: variable.type === "number" ? Number(event.target.value) : event.target.value,
            }))}
          />
        </label>
      ))}
      <button className="button button-primary" type="submit">Lưu đồ họa</button>
      {graphic && (
        <button className="button button-secondary" type="button" onClick={() => void onSave({
          id: graphic.id,
          remove: true,
          templateId: graphic.templateId,
          startSec: graphic.startSec,
          durationSec: graphic.durationSec,
          variables: graphic.variables,
        })}>Xóa đồ họa</button>
      )}
    </form>
  );
}
