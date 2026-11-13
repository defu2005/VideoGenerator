import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  EDIT_PRESETS,
  FONT_REGISTRY,
  LAYOUT_FAMILIES,
  checkPalette,
  resolvePalette,
  type StyleTokens,
} from "@vg/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { apiRequest } from "../../services/apiClient";

type Issue = { pair: string; ratio: number; min: number };
type StyleSummary = {
  fingerprint: string;
  color: Record<string, unknown>;
  fonts: { display: string; body: string };
  issues: { contrast: Issue[]; fonts: unknown[] };
  adjusted: string[];
};
type Similar = { profileId: string; name: string; score: number };
type PackView = { version: number; name: string; origin: { kind: string; note?: string; presetId?: string } };
type Saved = { pack: PackView; tokens: StyleTokens; changed: boolean; style: StyleSummary; similar: Similar[] };
type Draft = { pack: PackView; tokens: StyleTokens; dropped: string[]; source: "llm" | "preset"; message: string; style: StyleSummary; similar: Similar[] };
type Preview = { fingerprint: string; aspect: string; frames: Array<{ id: string; label: string; dataUrl: string }>; style: StyleSummary; warning?: string; cached: boolean };
type Versions = { versions: Array<{ version: number; name: string; origin: PackView["origin"]; fingerprint: string; current: boolean; tokens: StyleTokens }> };
type Presets = { presets: Array<{ id: string; nameVi: string; descriptionVi: string }> };

const ORIGIN_LABEL: Record<string, string> = {
  preset: "Mẫu có sẵn", choices: "Chọn nhanh", llm: "AI gợi ý", brand: "Màu thương hiệu", manual: "Sửa tay",
};
const RHYTHM_LABEL: Record<string, string> = { calm: "Chậm rãi", energetic: "Sôi nổi", news: "Tin tức", story: "Kể chuyện" };
const LAYOUT_LABEL: Record<string, string> = { editorial: "Tạp chí", centered: "Căn giữa", poster: "Áp phích", grid: "Lưới" };
const HEX = /^#[0-9a-fA-F]{6}$/;

function swatches(color: Record<string, unknown>): string[] {
  return ["bg", "bgAlt", "text", "accent", "accent2"].map((key) => String(color[key] ?? "")).filter((value) => HEX.test(value));
}

function Swatches({ color }: { color: Record<string, unknown> }) {
  return (
    <div style={{ display: "flex", gap: 6 }} aria-label="Bảng màu">
      {swatches(color).map((value, index) => (
        <span key={`${value}-${index}`} title={value} style={{ width: 28, height: 28, borderRadius: 6, background: value, border: "1px solid rgba(128,128,128,.5)" }} />
      ))}
    </div>
  );
}

export function StyleTab({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const base = `/profiles/${profileId}/style-pack`;
  const packKey = ["profile", profileId, "style-pack"];
  const pack = useQuery({
    queryKey: packKey,
    queryFn: () => apiRequest<{ pack: PackView | null; tokens: StyleTokens | null }>(base),
  });
  const versions = useQuery({ queryKey: [...packKey, "versions"], queryFn: () => apiRequest<Versions>(`${base}/versions`) });
  const presets = useQuery({ queryKey: ["style-presets"], queryFn: () => apiRequest<Presets>("/style/presets") });

  const [tokens, setTokens] = useState<StyleTokens | null>(null);
  const [mode, setMode] = useState<"" | "preset" | "choices" | "brand">("");
  const [presetId, setPresetId] = useState("");
  const [choice, setChoice] = useState({ brand: "#2563EB", mode: "dark", energy: "balanced", layout: "editorial" });
  const [brandText, setBrandText] = useState("#0E7490, #F59E0B");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [pending, setPending] = useState<null | { label: string; run: () => void }>(null);

  const current = versions.data?.versions.find((item) => item.current);
  // The first read of a channel makes its starting pack, so the versions list can be ahead of the pack query.
  const baseTokens = pack.data?.tokens ?? current?.tokens ?? null;
  const basePack: PackView | null = pack.data?.pack ?? (current ? { version: current.version, name: current.name, origin: current.origin } : null);
  useEffect(() => {
    if (baseTokens) setTokens(baseTokens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(baseTokens)]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: packKey });
  };
  const afterSave = async (result: Saved) => {
    setSaved(result);
    setSimilar(result.similar);
    setDraft(null);
    setMode("");
    await refresh();
  };
  const post = <T,>(path: string, body: unknown) => apiRequest<T>(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });

  const create = useMutation({ mutationFn: (input: { path: string; body: unknown }) => post<Saved>(input.path, input.body), onSuccess: afterSave });
  const propose = useMutation({ mutationFn: () => post<Draft>("/propose", note.trim() ? { note: note.trim() } : {}), onSuccess: (result) => { setDraft(result); setSimilar(result.similar); } });
  const save = useMutation({
    mutationFn: (patch: Partial<StyleTokens>) => apiRequest<Saved>(base, { method: "PUT", body: JSON.stringify({ patch, reason: "Sửa tay trong tab Phong cách" }) }),
    onSuccess: afterSave,
  });
  const revert = useMutation({ mutationFn: (version: number) => post<Saved>("/revert", { version }), onSuccess: afterSave });
  const preview = useMutation({ mutationFn: (body: object) => post<Preview>("/preview", body) });

  const issues = useMemo<Issue[]>(() => {
    if (!tokens) return [];
    try {
      return checkPalette(resolvePalette(tokens.palette));
    } catch {
      return [];
    }
  }, [tokens]);

  const error = (pack.error ?? create.error ?? propose.error ?? save.error ?? revert.error ?? preview.error) as Error | null;
  const busy = create.isPending || propose.isPending || save.isPending || revert.isPending;
  const style = saved?.style ?? preview.data?.style;
  const dirty = tokens && baseTokens && JSON.stringify(tokens) !== JSON.stringify(baseTokens);

  function setGroup<K extends keyof StyleTokens>(key: K, value: Partial<StyleTokens[K]>) {
    setTokens((previous) => (previous ? { ...previous, [key]: { ...(previous[key] as object), ...(value as object) } } : previous));
  }
  const fonts = Object.values(FONT_REGISTRY).filter((spec) => spec.subsets.includes("vietnamese"));

  const ask = (label: string, run: () => void) => setPending({ label, run });

  return (
    <section className="panel" aria-label="Phong cách">
      <h2>Phong cách kênh</h2>
      <p>Màu, phông chữ và nhịp dựng của kênh. Bản mới chỉ áp dụng cho video render sau này, video đã render không đổi.</p>
      {pack.isPending && <p>Đang tải phong cách…</p>}
      {error && <p role="alert">{error.message}</p>}
      {pack.data && !basePack && <p>Kênh chưa có phong cách riêng. Hãy tạo một bản bên dưới.</p>}

      {basePack && tokens && (
        <div>
          <h3>Bản hiện tại: v{basePack.version} · {ORIGIN_LABEL[basePack.origin.kind] ?? basePack.origin.kind}</h3>
          {style ? <Swatches color={style.color} /> : (
            <div style={{ display: "flex", gap: 6 }}>
              {[tokens.palette.brand, tokens.palette.accent].map((value) => <span key={value} style={{ width: 28, height: 28, borderRadius: 6, background: value }} />)}
            </div>
          )}
          <p>
            Phông: {tokens.type.display.family} / {tokens.type.body.family} · Nhịp: {RHYTHM_LABEL[tokens.rhythm.preset] ?? tokens.rhythm.preset} (×{tokens.rhythm.paceScale}) · Bố cục: {LAYOUT_LABEL[tokens.layout.family] ?? tokens.layout.family}
          </p>
          <button type="button" className="button button-secondary" disabled={preview.isPending} onClick={() => preview.mutate({})}>
            {preview.isPending ? "Đang dựng khung xem thử…" : "Xem thử 3 khung"}
          </button>
          {preview.data && (
            <div>
              {preview.data.warning && <p role="status">{preview.data.warning}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {preview.data.frames.map((frame) => (
                  <figure key={frame.id} style={{ margin: 0 }}>
                    <img src={frame.dataUrl} alt={`Khung xem thử: ${frame.label}`} style={{ maxHeight: 160, borderRadius: 6 }} />
                    <figcaption>{frame.label}</figcaption>
                  </figure>
                ))}
              </div>
              {preview.data.frames.length === 0 && <Swatches color={preview.data.style.color} />}
            </div>
          )}
          {saved && saved.style.adjusted.length > 0 && (
            <ul aria-label="Màu đã chỉnh">{saved.style.adjusted.map((line) => <li key={line}>{line}</li>)}</ul>
          )}
        </div>
      )}

      {similar.length > 0 && (
        <p role="status">
          Giống kênh khác: {similar.map((item) => `${item.name} (${Math.round(item.score * 100)}%)`).join(", ")}. Nên chọn phong cách khác để người xem phân biệt các kênh.
        </p>
      )}

      <h3>Tạo phong cách mới</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="button button-secondary" onClick={() => setMode("preset")} disabled={busy}>Chọn mẫu</button>
        <button type="button" className="button button-secondary" onClick={() => setMode("choices")} disabled={busy}>Chọn nhanh</button>
        <button type="button" className="button button-secondary" onClick={() => setMode("brand")} disabled={busy}>Từ màu thương hiệu</button>
        <button type="button" className="button" onClick={() => propose.mutate()} disabled={busy}>
          {propose.isPending ? "Đang gợi ý…" : "Gợi ý bằng AI"}
        </button>
      </div>
      <label>
        Ghi chú cho AI (tùy chọn)
        <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: sạch, hiện đại, hơi ấm" />
      </label>

      {mode === "preset" && (
        <fieldset>
          <legend>Mẫu có sẵn</legend>
          <select aria-label="Mẫu phong cách" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
            <option value="">— Chọn mẫu —</option>
            {presets.data?.presets.map((item) => <option key={item.id} value={item.id}>{item.nameVi}</option>)}
          </select>
          {presetId && <p>{presets.data?.presets.find((item) => item.id === presetId)?.descriptionVi}</p>}
          <button type="button" className="button" disabled={!presetId || busy}
            onClick={() => ask("Dùng mẫu này làm phong cách của kênh?", () => create.mutate({ path: "/from-preset", body: { presetId } }))}>Dùng mẫu</button>
        </fieldset>
      )}
      {mode === "choices" && (
        <fieldset>
          <legend>Chọn nhanh</legend>
          <label>Màu chủ đạo <input aria-label="Màu chủ đạo" value={choice.brand} onChange={(event) => setChoice({ ...choice, brand: event.target.value })} /></label>
          <label>Nền
            <select aria-label="Nền" value={choice.mode} onChange={(event) => setChoice({ ...choice, mode: event.target.value })}>
              <option value="dark">Tối</option><option value="light">Sáng</option>
            </select>
          </label>
          <label>Năng lượng
            <select aria-label="Năng lượng" value={choice.energy} onChange={(event) => setChoice({ ...choice, energy: event.target.value })}>
              <option value="calm">Điềm tĩnh</option><option value="balanced">Cân bằng</option><option value="lively">Sôi động</option>
            </select>
          </label>
          <label>Bố cục
            <select aria-label="Bố cục" value={choice.layout} onChange={(event) => setChoice({ ...choice, layout: event.target.value })}>
              {LAYOUT_FAMILIES.map((family) => <option key={family} value={family}>{LAYOUT_LABEL[family]}</option>)}
            </select>
          </label>
          <button type="button" className="button" disabled={busy || !HEX.test(choice.brand)}
            onClick={() => ask("Tạo phong cách từ các lựa chọn này?", () => create.mutate({ path: "/from-choices", body: choice }))}>Tạo</button>
        </fieldset>
      )}
      {mode === "brand" && (
        <fieldset>
          <legend>Từ màu thương hiệu</legend>
          <label>Các màu (#RRGGBB, cách nhau dấu phẩy)
            <input aria-label="Màu thương hiệu" value={brandText} onChange={(event) => setBrandText(event.target.value)} />
          </label>
          <button type="button" className="button" disabled={busy}
            onClick={() => {
              const colors = brandText.split(/[\s,]+/).filter(Boolean);
              ask("Tạo phong cách từ các màu này?", () => create.mutate({ path: "/from-brand", body: { colors } }));
            }}>Tạo</button>
        </fieldset>
      )}

      {draft && (
        <div role="region" aria-label="Bản nháp AI">
          <h3>Bản nháp {draft.source === "llm" ? "từ AI" : "từ mẫu có sẵn"}</h3>
          <p>{draft.message}</p>
          <Swatches color={draft.style.color} />
          <p>Phông: {draft.style.fonts.display} / {draft.style.fonts.body}</p>
          {draft.dropped.length > 0 && (
            <div role="status">
              <p>Những phần AI đề xuất nhưng không dùng được:</p>
              <ul>{draft.dropped.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
          )}
          {draft.similar.length > 0 && <p role="status">Giống kênh khác: {draft.similar.map((item) => item.name).join(", ")}.</p>}
          <button type="button" className="button" disabled={busy}
            onClick={() => ask("Lưu bản nháp này làm phong cách của kênh?", () => save.mutate(draft.tokens))}>Lưu bản nháp</button>
          <button type="button" className="button button-secondary" onClick={() => setDraft(null)}>Bỏ bản nháp</button>
        </div>
      )}

      {tokens && basePack && (
        <div>
          <h3>Chỉnh chi tiết</h3>
          <fieldset>
            <legend>Màu</legend>
            <label>Nền
              <select aria-label="Chế độ nền" value={tokens.palette.mode} onChange={(event) => setGroup("palette", { mode: event.target.value as "dark" | "light" })}>
                <option value="dark">Tối</option><option value="light">Sáng</option>
              </select>
            </label>
            <label>Màu nền <input aria-label="Màu nền" type="color" value={tokens.palette.brand} onChange={(event) => setGroup("palette", { brand: event.target.value.toUpperCase() })} /></label>
            <label>Màu nhấn <input aria-label="Màu nhấn" type="color" value={tokens.palette.accent} onChange={(event) => setGroup("palette", { accent: event.target.value.toUpperCase() })} /></label>
            {issues.length > 0 && (
              <ul role="alert" aria-label="Cảnh báo tương phản">
                {issues.map((issue) => <li key={issue.pair}>Chữ khó đọc ở cặp {issue.pair}: tương phản {issue.ratio}, cần ít nhất {issue.min}.</li>)}
              </ul>
            )}
          </fieldset>
          <fieldset>
            <legend>Phông chữ</legend>
            <label>Tiêu đề
              <select aria-label="Phông tiêu đề" value={tokens.type.display.family} onChange={(event) => setGroup("type", { display: { ...tokens.type.display, family: event.target.value } })}>
                {fonts.map((spec) => <option key={spec.id} value={spec.id}>{spec.css}</option>)}
              </select>
            </label>
            <label>Nội dung
              <select aria-label="Phông nội dung" value={tokens.type.body.family} onChange={(event) => setGroup("type", { body: { ...tokens.type.body, family: event.target.value } })}>
                {fonts.map((spec) => <option key={spec.id} value={spec.id}>{spec.css}</option>)}
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>Nhịp dựng</legend>
            <label>Kiểu nhịp
              <select aria-label="Kiểu nhịp" value={tokens.rhythm.preset} onChange={(event) => setGroup("rhythm", { preset: event.target.value as StyleTokens["rhythm"]["preset"] })}>
                {EDIT_PRESETS.map((item) => <option key={item} value={item}>{RHYTHM_LABEL[item]}</option>)}
              </select>
            </label>
            <label>Tốc độ cắt: ×{tokens.rhythm.paceScale}
              <input aria-label="Tốc độ cắt" type="range" min={0.6} max={1.5} step={0.05} value={tokens.rhythm.paceScale} onChange={(event) => setGroup("rhythm", { paceScale: Number(event.target.value) })} />
            </label>
          </fieldset>
          <button type="button" className="button" disabled={!dirty || busy || issues.length > 0}
            onClick={() => ask("Lưu thay đổi phong cách? Chỉ áp dụng cho video render sau.", () => save.mutate(tokens))}>Lưu thay đổi</button>
          <button type="button" className="button button-secondary" disabled={!dirty || busy} onClick={() => setTokens(baseTokens)}>Hoàn tác chỉnh sửa</button>
          <button type="button" className="button button-secondary" disabled={!dirty || preview.isPending} onClick={() => preview.mutate({ tokens })}>Xem thử bản đang sửa</button>
        </div>
      )}

      {versions.data && versions.data.versions.length > 0 && (
        <div>
          <h3>Lịch sử phiên bản</h3>
          <ul>
            {versions.data.versions.map((item) => (
              <li key={item.version}>
                v{item.version} · {ORIGIN_LABEL[item.origin.kind] ?? item.origin.kind}{item.origin.note ? ` · ${item.origin.note}` : ""}{item.current ? " · đang dùng" : ""}
                {!item.current && (
                  <button type="button" className="button button-secondary" disabled={busy}
                    onClick={() => ask(`Quay lại bản v${item.version}? Bản này sẽ được lưu thành một phiên bản mới.`, () => revert.mutate(item.version))}>Quay lại bản này</button>
                )}
              </li>
            ))}
          </ul>
          {current && <p><small>Bản cũ không bị xóa; quay lại chỉ tạo thêm phiên bản mới.</small></p>}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title="Lưu phong cách?"
        message={pending?.label ?? ""}
        confirmLabel="Lưu"
        cancelLabel="Không lưu"
        onCancel={() => setPending(null)}
        onConfirm={() => { pending?.run(); setPending(null); }}
      />
    </section>
  );
}
