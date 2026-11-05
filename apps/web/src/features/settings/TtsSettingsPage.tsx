import { TTS_CATALOG, type TtsSettingsResponse } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";
import { getTtsVoices } from "../../services/voiceApi";

const SAMPLE = "Xin chào, đây là giọng đọc thử.";

function defaultVoiceName(providerId: string): string {
  if (providerId === "google_cloud") return "vi-VN-Neural2-A";
  if (providerId === "gemini") return "Kore";
  if (providerId === "openai") return "nova";
  if (providerId === "fpt_ai") return "banmai";
  if (providerId === "viettel_ai") return "hn-quynhanh";
  if (providerId === "vieneu") return "default";
  return "vi-VN-HoaiMyNeural";
}

export function TtsSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["tts-settings"],
    queryFn: () => apiRequest<TtsSettingsResponse>("/settings/tts"),
  });
  const [message, setMessage] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [voicesByProvider, setVoicesByProvider] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [audioSrc, setAudioSrc] = useState("");
  const [browserProvider, setBrowserProvider] = useState("edge-tts");
  const [language, setLanguage] = useState("vi");
  const [gender, setGender] = useState("");
  const [sampleText, setSampleText] = useState(SAMPLE);
  const data = settings.data;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("/settings/tts", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: async () => {
      setMessage("Đã lưu.");
      await queryClient.invalidateQueries({ queryKey: ["tts-settings"] });
    },
  });
  const saveKey = useMutation({
    mutationFn: (body: { provider: string; apiKey: string }) => apiRequest("/settings/tts/secret", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: async (_data, variables) => {
      setKeys((current) => ({ ...current, [variables.provider]: "" }));
      setMessage("Đã lưu key. Key không được hiển thị lại.");
      await queryClient.invalidateQueries({ queryKey: ["tts-settings"] });
    },
  });
  const preview = useMutation({
    mutationFn: (body: { provider: string; voice: string; text: string; rate?: string }) =>
      apiRequest<{ url: string }>("/settings/tts/preview", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (result) => setAudioSrc(result.url),
  });
  const browser = useQuery({
    queryKey: ["tts-browser", browserProvider, language],
    queryFn: () => getTtsVoices({ provider: browserProvider, language }),
    enabled: Boolean(data),
  });

  if (settings.isLoading) return <section className="page-section"><p>Đang tải giọng đọc…</p></section>;
  if (!data) return <section className="page-section"><p>Không tải được cài đặt giọng đọc.</p></section>;

  const shownVoices = (browser.data?.voices ?? []).filter((voice) => !gender || (voice.gender ?? "unknown") === gender);
  const priceValue = (id: string, fallback: number) => prices[id] ?? String(data.settings.pricesPerMillion[id] ?? fallback);

  return (
    <section className="page-section tts-page">
      <h1>Giọng đọc (TTS)</h1>
      <p>Key chỉ nhập một lần và không bao giờ hiện lại. Giá là USD cho 1 triệu ký tự, có thể sửa.</p>
      {message && <p role="status">{message}</p>}
      <form
        className="form-row"
        onSubmit={(event) => {
          event.preventDefault();
          const pricesPerMillion = { ...data.settings.pricesPerMillion };
          for (const [id, value] of Object.entries(prices)) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) pricesPerMillion[id] = parsed;
          }
          const defaultProvider = (event.currentTarget.elements.namedItem("defaultProvider") as HTMLSelectElement).value;
          const defaultVoice = (event.currentTarget.elements.namedItem("defaultVoice") as HTMLInputElement).value;
          const defaultRate = (event.currentTarget.elements.namedItem("defaultRate") as HTMLInputElement).value;
          save.mutate({
            defaultProvider,
            defaultVoice,
            defaultRate,
            pricesPerMillion,
            geminiModel: (event.currentTarget.elements.namedItem("geminiModel") as HTMLInputElement | null)?.value,
            elevenModel: (event.currentTarget.elements.namedItem("elevenModel") as HTMLInputElement | null)?.value,
            openaiModel: (event.currentTarget.elements.namedItem("openaiModel") as HTMLInputElement | null)?.value,
            piperBinary: (event.currentTarget.elements.namedItem("piperBinary") as HTMLInputElement | null)?.value,
            piperModelsDir: (event.currentTarget.elements.namedItem("piperModelsDir") as HTMLInputElement | null)?.value,
            vieneuTemplate: (event.currentTarget.elements.namedItem("vieneuTemplate") as HTMLTextAreaElement | null)?.value,
          });
        }}
      >
        <label className="form-field">
          <span>Nhà cung cấp mặc định</span>
          <select name="defaultProvider" aria-label="Nhà cung cấp mặc định" defaultValue={data.settings.defaultProvider}>
            {data.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Giọng mặc định</span>
          <input name="defaultVoice" aria-label="Giọng mặc định" defaultValue={data.settings.defaultVoice} />
        </label>
        <label className="form-field">
          <span>Tốc độ mặc định</span>
          <input name="defaultRate" aria-label="Tốc độ mặc định" defaultValue={data.settings.defaultRate} />
        </label>
        <div className="tts-grid">
          {data.providers.map((provider) => {
            const catalog = TTS_CATALOG.find((entry) => entry.id === provider.id);
            return (
              <article key={provider.id} className="card">
                <h2>{provider.label}</h2>
                <p>{provider.configured ? "Đã cấu hình" : "Chưa cấu hình"}{provider.wordTimings ? " · Có mốc thời gian từng từ" : ""}</p>
                {provider.kind === "http" && (
                  <label className="form-field">
                    <span>API key</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      aria-label={`API key ${provider.label}`}
                      value={keys[provider.id] ?? ""}
                      onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => saveKey.mutate({ provider: provider.id, apiKey: keys[provider.id] ?? "" })}
                    >
                      Lưu key {provider.label}
                    </button>
                  </label>
                )}
                {provider.id === "piper" && (
                  <>
                    <label className="form-field"><span>Đường dẫn Piper</span><input name="piperBinary" aria-label="Đường dẫn Piper" defaultValue={provider.binaryPath ?? ""} /></label>
                    <label className="form-field"><span>Thư mục model</span><input name="piperModelsDir" aria-label="Thư mục model Piper" defaultValue={provider.modelsDir ?? ""} /></label>
                  </>
                )}
                {provider.id === "vieneu" && (
                  <label className="form-field"><span>Lệnh VieNeu</span><textarea name="vieneuTemplate" aria-label="Lệnh VieNeu" defaultValue={provider.commandTemplate ?? ""} /></label>
                )}
                {provider.model !== undefined && (
                  <label className="form-field">
                    <span>Model</span>
                    <input name={provider.id === "gemini" ? "geminiModel" : provider.id === "elevenlabs" ? "elevenModel" : "openaiModel"} aria-label={`Model ${provider.label}`} defaultValue={provider.model ?? ""} />
                  </label>
                )}
                <label className="form-field">
                  <span>Giá / 1 triệu ký tự (USD)</span>
                  <input
                    aria-label={`Giá ${provider.label}`}
                    value={priceValue(provider.id, provider.pricePerMillion)}
                    onChange={(event) => setPrices((current) => ({ ...current, [provider.id]: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Giọng để kiểm tra</span>
                  <input
                    aria-label={`Giọng kiểm tra ${provider.label}`}
                    value={voicesByProvider[provider.id] ?? defaultVoiceName(provider.id)}
                    onChange={(event) => setVoicesByProvider((current) => ({ ...current, [provider.id]: event.target.value }))}
                  />
                </label>
                {provider.subscription && <p>Đã dùng {provider.subscription.charactersUsed} / {provider.subscription.characterLimit} ký tự.</p>}
                <button
                  type="button"
                  onClick={() => preview.mutate({
                    provider: provider.id,
                    voice: voicesByProvider[provider.id] ?? defaultVoiceName(provider.id),
                    text: SAMPLE,
                    rate: data.settings.defaultRate,
                  })}
                >
                  Kiểm tra {provider.label}
                </button>
                {catalog?.paid && <small>Trả phí. Chế độ tiết kiệm chỉ dùng khi hồ sơ ghim đúng nhà cung cấp này.</small>}
              </article>
            );
          })}
        </div>
        <button className="button button-primary" type="submit">Lưu giọng đọc</button>
      </form>
      {audioSrc && <audio data-testid="tts-sample" src={audioSrc} controls autoPlay />}
      {preview.isError && <p className="field-error">{preview.error.message}</p>}
      <h2>Duyệt giọng</h2>
      <div className="form-row">
        <label className="form-field">
          <span>Nhà cung cấp</span>
          <select aria-label="Nhà cung cấp duyệt giọng" value={browserProvider} onChange={(event) => setBrowserProvider(event.target.value)}>
            {data.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Ngôn ngữ</span>
          <input aria-label="Lọc ngôn ngữ" value={language} onChange={(event) => setLanguage(event.target.value)} />
        </label>
        <label className="form-field">
          <span>Giới tính</span>
          <select aria-label="Lọc giới tính giọng" value={gender} onChange={(event) => setGender(event.target.value)}>
            <option value="">Tất cả</option>
            <option value="female">Nữ</option>
            <option value="male">Nam</option>
          </select>
        </label>
        <label className="form-field">
          <span>Câu nghe thử</span>
          <input aria-label="Câu nghe thử" value={sampleText} onChange={(event) => setSampleText(event.target.value)} />
        </label>
      </div>
      <ul>
        {shownVoices.map((voice) => (
          <li key={voice.name}>
            {voice.name} · {voice.language} · {voice.gender ?? "unknown"}
            <button
              type="button"
              onClick={() => preview.mutate({ provider: browserProvider, voice: voice.name, text: sampleText, rate: data.settings.defaultRate })}
            >
              Nghe thử {voice.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
