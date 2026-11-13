import { useState } from "react";
import type { Script, ScriptSection } from "@vg/shared";

const SPEECH_WORDS_PER_MINUTE = 150;

export function scriptMetrics(script: Script) {
  const text = [script.hook, ...script.sections.map((section) => section.narration), script.outro].join(" ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    words,
    durationSec: Math.round(words * 60 / SPEECH_WORDS_PER_MINUTE),
  };
}

function sectionDuration(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words * 60 / SPEECH_WORDS_PER_MINUTE);
}

function newSection(order: number): ScriptSection {
  return {
    id: `section-${Date.now()}-${order}`,
    heading: `Phần ${order + 1}`,
    narration: "",
    visualQueries: { primary: "", alternatives: [] },
    visualNotes: "",
    musicMood: "",
    energy: "medium",
    estDurationSec: 0,
  };
}

export function ScriptEditor({
  initialValue,
  targetDurationSec,
  disabled,
  onChange,
  onSave,
}: {
  initialValue: Script;
  targetDurationSec: number;
  disabled: boolean;
  onChange: () => void;
  onSave: (script: Script) => Promise<void>;
}) {
  const [script, setScript] = useState(initialValue);
  const [saveError, setSaveError] = useState("");
  const metrics = scriptMetrics(script);

  function updateScript(next: Script) {
    setScript(next);
    onChange();
  }

  function updateSection(index: number, patch: Partial<ScriptSection>) {
    updateScript({
      ...script,
      sections: script.sections.map((section, current) => current === index ? { ...section, ...patch } : section),
    });
  }

  async function save() {
    setSaveError("");
    try {
      await onSave({
        ...script,
        sections: script.sections.map((section) => ({
          ...section,
          estDurationSec: sectionDuration(section.narration),
        })),
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không lưu được kịch bản");
    }
  }

  return (
    <section className="panel script-editor" aria-label="Trình sửa kịch bản">
      <div className="script-editor-heading">
        <div><p className="eyebrow">KỊCH BẢN</p><h2>Sửa lời thoại</h2></div>
        <div className="script-metrics"><strong>{metrics.words} từ</strong><span>{metrics.durationSec}s / {targetDurationSec}s mục tiêu</span></div>
      </div>
      {saveError && <p className="request-error" role="alert">{saveError}</p>}
      <label className="form-field"><span>Tiêu đề</span>
        <input value={script.title} onChange={(event) => updateScript({ ...script, title: event.target.value })} />
      </label>
      <label className="form-field"><span>Mở đầu</span>
        <textarea rows={3} value={script.hook} onChange={(event) => updateScript({ ...script, hook: event.target.value })} />
      </label>
      <fieldset className="script-section">
        <legend>Hướng nhạc</legend>
        <label className="form-field"><span>Không khí</span>
          <input value={script.music.mood} onChange={(event) => updateScript({ ...script, music: { ...script.music, mood: event.target.value } })} />
        </label>
        <label className="form-field"><span>Năng lượng</span>
          <select value={script.music.energy} onChange={(event) => updateScript({ ...script, music: { ...script.music, energy: event.target.value as Script["music"]["energy"] } })}>
            <option value="low">Thấp</option><option value="medium">Vừa</option><option value="high">Cao</option>
          </select>
        </label>
        <label className="form-field"><span>Từ khóa (cách nhau bằng dấu phẩy)</span>
          <input
            value={script.music.keywords.join(", ")}
            onChange={(event) => updateScript({ ...script, music: { ...script.music, keywords: event.target.value.split(",").map((word) => word.trim()).filter(Boolean) } })}
          />
        </label>
      </fieldset>
      <div className="script-sections-heading"><h3>Các phần</h3>
        <button className="button button-secondary" type="button" onClick={() => updateScript({ ...script, sections: [...script.sections, newSection(script.sections.length)] })}>Thêm phần</button>
      </div>
      {script.sections.map((section, index) => (
        <fieldset className="script-section" key={section.id}>
          <legend>{section.heading || `Phần ${index + 1}`}</legend>
          <label className="form-field"><span>Tiêu đề phần</span>
            <input value={section.heading} onChange={(event) => updateSection(index, { heading: event.target.value })} />
          </label>
          <label className="form-field"><span>Lời thoại</span>
            <textarea rows={6} value={section.narration} onChange={(event) => updateSection(index, { narration: event.target.value })} />
          </label>
          <label className="form-field"><span>Câu tìm hình chính (tiếng Anh)</span>
            <input
              value={section.visualQueries.primary}
              onChange={(event) => updateSection(index, { visualQueries: { ...section.visualQueries, primary: event.target.value } })}
            />
          </label>
          <label className="form-field"><span>Câu tìm hình khác (cách nhau bằng dấu phẩy)</span>
            <input
              value={section.visualQueries.alternatives.join(", ")}
              onChange={(event) => updateSection(index, {
                visualQueries: {
                  ...section.visualQueries,
                  alternatives: event.target.value.split(",").map((query) => query.trim()).filter(Boolean).slice(0, 3),
                },
              })}
            />
          </label>
          <label className="form-field"><span>Ghi chú hình</span>
            <textarea rows={2} value={section.visualNotes} onChange={(event) => updateSection(index, { visualNotes: event.target.value })} />
          </label>
          <div className="form-grid">
            <label className="form-field"><span>Không khí nhạc</span>
              <input value={section.musicMood} onChange={(event) => updateSection(index, { musicMood: event.target.value })} />
            </label>
            <label className="form-field"><span>Năng lượng</span>
              <select value={section.energy} onChange={(event) => updateSection(index, { energy: event.target.value as ScriptSection["energy"] })}>
                <option value="low">Thấp</option><option value="medium">Vừa</option><option value="high">Cao</option>
              </select>
            </label>
          </div>
          <div className="script-section-actions">
            <small>Ước tính lời: {sectionDuration(section.narration)} giây</small>
            <button type="button" className="text-button" disabled={index === 0} onClick={() => {
              const sections = [...script.sections];
              [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
              updateScript({ ...script, sections });
            }}>Lên</button>
            <button type="button" className="text-button" disabled={index === script.sections.length - 1} onClick={() => {
              const sections = [...script.sections];
              [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]];
              updateScript({ ...script, sections });
            }}>Xuống</button>
            <button type="button" className="text-button script-remove" disabled={script.sections.length <= 1} onClick={() => {
              updateScript({ ...script, sections: script.sections.filter((_, current) => current !== index) });
            }}>Xóa phần</button>
          </div>
        </fieldset>
      ))}
      <label className="form-field"><span>Kết</span>
        <textarea rows={3} value={script.outro} onChange={(event) => updateScript({ ...script, outro: event.target.value })} />
      </label>
      <div className="script-save-actions">
        <small>Ước tính: {metrics.durationSec} giây · Khoảng mục tiêu: {Math.round(targetDurationSec * 0.8)}–{Math.round(targetDurationSec * 1.2)} giây</small>
        <button className="button button-primary" type="button" disabled={disabled} onClick={() => void save()}>Lưu</button>
      </div>
    </section>
  );
}
