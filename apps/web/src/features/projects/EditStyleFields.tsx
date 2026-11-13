import {
  resolveEditEngine,
  SUBTITLE_STYLE_LABELS,
  SUBTITLE_STYLES,
  type EditSettings,
  type SubtitleStyleId,
} from "@vg/shared";

export function EditStyleFields({
  edit,
  onChange,
  idPrefix,
}: {
  edit: EditSettings | undefined;
  onChange: (edit: EditSettings) => void;
  idPrefix: string;
}) {
  const current = edit ?? {};
  const engine = resolveEditEngine(current.engine);

  function patch(next: EditSettings) {
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== "")) as EditSettings;
    onChange(cleaned);
  }

  return (
    <>
      <label className="form-field">
        <span>Kiểu dựng</span>
        <select
          aria-label={`${idPrefix} kiểu dựng`}
          value={engine}
          onChange={(event) => {
            const next = { ...current };
            if (event.target.value === "legacy") {
              next.engine = "legacy";
              delete next.directorMode;
            } else next.engine = "compose";
            patch(next);
          }}
        >
          <option value="legacy">Cổ điển (ảnh tĩnh)</option>
          <option value="compose">Nhiều cảnh quay (thử nghiệm)</option>
        </select>
      </label>
      {engine !== "legacy" ? (
        <label className="form-field">
          <span>Đạo diễn</span>
          <select
            aria-label={`${idPrefix} đạo diễn`}
            value={current.directorMode ?? "eco"}
            onChange={(event) => patch({ ...current, directorMode: event.target.value === "quality" ? "quality" : "eco" })}
          >
            <option value="eco">Tiết kiệm (luật)</option>
            <option value="quality">Chất lượng (+1 lần gọi AI)</option>
          </select>
        </label>
      ) : null}
      <label className="form-field">
        <span>Kiểu phụ đề</span>
        <select
          aria-label={`${idPrefix} kiểu phụ đề`}
          value={current.subtitleStyle ?? ""}
          onChange={(event) => {
            const subtitleStyle = event.target.value as SubtitleStyleId | "";
            const next = { ...current };
            if (!subtitleStyle) delete next.subtitleStyle;
            else next.subtitleStyle = subtitleStyle;
            patch(next);
          }}
        >
          <option value="">Theo preset</option>
          {SUBTITLE_STYLES.map((style) => <option key={style} value={style}>{SUBTITLE_STYLE_LABELS[style]}</option>)}
        </select>
      </label>
      <label className="form-field">
        <span>Cỡ chữ</span>
        <input
          aria-label={`${idPrefix} cỡ chữ`}
          type="number"
          min={12}
          max={160}
          placeholder="Tự chọn"
          value={current.fontSize ?? ""}
          onChange={(event) => {
            const next = { ...current };
            const fontSize = Number(event.target.value);
            if (!event.target.value || !Number.isFinite(fontSize)) delete next.fontSize;
            else next.fontSize = Math.min(160, Math.max(12, Math.round(fontSize)));
            patch(next);
          }}
        />
      </label>
      <label className="form-field">
        <span>Màu nhấn phụ đề</span>
        <input
          aria-label={`${idPrefix} màu nhấn phụ đề`}
          type="color"
          value={current.highlightColor ?? "#F5C518"}
          onChange={(event) => patch({ ...current, highlightColor: event.target.value })}
        />
      </label>
      <label className="form-field">
        <span>Khoảng nhấn mạnh (giây)</span>
        <input
          aria-label={`${idPrefix} khoảng nhấn mạnh`}
          type="number"
          min={6}
          max={60}
          step={1}
          placeholder="Theo preset"
          value={current.emphasisEverySec ?? ""}
          onChange={(event) => {
            const next = { ...current };
            const emphasisEverySec = Number(event.target.value);
            if (!event.target.value || !Number.isFinite(emphasisEverySec)) delete next.emphasisEverySec;
            else next.emphasisEverySec = Math.min(60, Math.max(6, emphasisEverySec));
            patch(next);
          }}
        />
      </label>
    </>
  );
}
