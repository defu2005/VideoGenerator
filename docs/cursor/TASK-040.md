# TASK-040 — Cursor guide (more TTS sources + word timings)

Read `docs/cursor/README.md` first. Today only `edge-tts` (CLI) and `mock` exist, in `apps/server/src/providers/tts/`. The interface is `TtsProvider { id, label, isAvailable, listVoices, synthesize → { durationSec, cues } }`, and the provider is picked by the env `TTS_PROVIDER`.

This task adds several providers, lets the user pick a provider and voice per app, profile and project, and adds **word-level timings**. TASK-041 needs those for animated word-highlight subtitles.

No new npm dependencies: HTTP via `fetch`, local engines via CLI spawn like `edgeTts.ts`. Tests mock fetch and spawn and never call real services or CLIs.

## 1. Interface changes (`types.ts`)
```ts
export type TtsWord = { startSec: number; endSec: number; text: string };
synthesize(input): Promise<{ durationSec: number; cues: TtsCue[]; words?: TtsWord[]; timingSource: "provider" | "aligned" | "estimated"; costUsd?: number; characters: number }>;
capabilities: { wordTimings: boolean; ssml: boolean; styles?: string[]; maxCharsPerRequest: number; languages: string[] };
```
- Long text is split by sentence under `maxCharsPerRequest`. The parts are concatenated with ffmpeg concat, and the timings are offset per part.
- Store `words` with the voice track: a new json column `voice_tracks.words` plus `timing_source` (migration).

## 2. Providers
Each provider has its own file and is registered in the registry. API keys are entered in the web UI and stored with `TokenVault.storeSecret("tts.<provider>.apiKey")`. They are never returned by the API and never logged. A provider is `isAvailable()` only when its key or CLI is configured.

| id | Kind | Notes |
|---|---|---|
| `google_cloud` | HTTP | Cloud Text-to-Speech `v1beta1/text:synthesize` with an API key. Use SSML `<mark name="w{i}"/>` before each word and `enableTimePointing: ["SSML_MARK"]` → word timings from `timepoints`. Voices: `voices.list?languageCode=vi-VN` (Neural2/Wavenet/Standard/Chirp3-HD). Escape SSML. |
| `gemini` | HTTP | Gemini API TTS model (`generateContent` with `responseModalities: ["AUDIO"]`, `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`). It returns raw PCM (24 kHz s16le mono), which is wrapped to WAV then encoded. A style prompt is allowed ("đọc giọng kể chuyện, chậm rãi"). No timings → alignment (§3). Make the model id a setting (default to the current TTS preview model name, editable). |
| `elevenlabs` | HTTP | `POST /v1/text-to-speech/{voice_id}/with-timestamps` (`model_id` setting, default the multilingual model). It returns base64 audio plus a character `alignment`; group the characters into words → provider timings. Voices: `GET /v1/voices`. Show the character usage from `GET /v1/user/subscription` on the settings page. |
| `openai` | HTTP | `POST /v1/audio/speech` (model setting, e.g. `gpt-4o-mini-tts`; voice list is static, from the docs; an `instructions` field for style). No timings → alignment. |
| `fpt_ai` | HTTP | FPT.AI TTS v5: POST text with headers `api-key`, `voice` (banmai, leminh, thuminh, giahuy, …) and `speed`. The response gives an async URL. Poll the URL (HEAD/GET every 1 s, max 60 s) until the mp3 is ready, then download. Vietnamese only. No timings → alignment. |
| `viettel_ai` | HTTP | Viettel AI TTS: POST JSON `{text, voice, speed, tts_return_option, token, without_filter}` → audio bytes. Vietnamese voices list is static, from the docs. No timings → alignment. |
| `piper` | CLI | Local `piper --model <onnx> --output_file out.wav` with text on stdin. Settings: the binary path and the model files folder. The voices are the `.onnx` files found (with their `.onnx.json`). Offline and free. No timings → alignment. |
| `vieneu` | CLI | Local VieNeu-TTS (Vietnamese) via a user-configured command template, e.g. `python -m vieneu --text-file {in} --voice {voice} --out {out}`, with `{in}` `{out}` `{voice}` placeholders. Validate that the template contains `{out}`. No timings → alignment. |
| `edge` | CLI | Keep the existing one. If the installed edge-tts can write word boundaries, parse them → provider timings; otherwise alignment. |

The endpoint URLs and field names change over time. Put each base URL in a constant and check the current official docs while implementing. Do not guess silently: when a field is uncertain, write it in the report.

## 3. Word alignment fallback (`apps/server/src/providers/tts/align.ts`)
For providers without timings:
1. If a speech-to-text CLI with word timestamps is configured (TASK-037 setting: whisper / whisper.cpp / faster-whisper), run it on the audio. Match the recognized words to the script words with a simple edit-distance alignment, so the script text wins and only the times are taken. Set `timingSource: "aligned"`.
2. Otherwise estimate:
   - ffmpeg `silencedetect` (noise -35 dB, d 0.15) splits the audio into voiced segments;
   - sentences are mapped to segments in order;
   - within a sentence, time is spread across the words by syllable count (Vietnamese: one syllable per space-separated token; other languages: vowel groups);
   - `timingSource: "estimated"`.
3. Sentence `cues` are always built from the words, so every provider gets consistent cues.

## 4. Selection and settings
- **App level:** default provider + voice + rate.
- **Profile level:** `voice` settings gain `provider`, `model?` and `style?`.
- **Project level:** override.
- The existing `TTS_PROVIDER` env becomes only the initial default.
- **Fallback chain:** if the chosen provider fails (after one retry) or has no key, fall back to the app default, then edge, then fail the stage with a Vietnamese error. Record which provider was actually used on the voice track.
- **Cost:** per-provider price per 1M characters (an editable settings table). Record `costUsd` and `characters` in usage, so it appears in "Mức dùng" with the provider name and TTS cost lines. TASK-034 costs read it.
- **Budget:** in the "economy" mode, the paid TTS providers are allowed only if the profile pinned one explicitly. Otherwise use edge/piper.

## 5. UI
A new settings page "Giọng đọc (TTS)" (`/settings/tts`):
- one card per provider:
  - status (configured / not), with a key field (password, never shown back) or the CLI path/template;
  - "Kiểm tra" synthesizes a 1-sentence sample and plays it;
  - price per 1M chars;
  - the model setting where relevant;
- the default provider and voice;
- a voice browser with a language filter, gender, and a "Nghe thử" button with the sample text editable (cached per voice + text hash).

The profile and project voice pickers show the provider + voice with a preview, and mark which have word timings ("Có mốc thời gian từng từ").

## 6. Tests (mock fetch/spawn, no network, no real CLIs)
- Per provider, the request builder (URL, headers without leaking the key into logs, body) and the response parser:
  - Google timepoints become words;
  - ElevenLabs characters become words;
  - FPT async polling succeeds and times out;
  - Gemini PCM becomes a WAV header;
  - Piper and VieNeu command templates, including the `{out}` validation.
- Long text splitting plus the concat offsets of words and cues.
- Alignment:
  - edit-distance matching keeps the script text;
  - the estimator with silence segments and syllable weights;
  - monotonic, non-overlapping timings that cover the whole duration.
- The fallback chain and the actually-used provider record; budget economy blocks paid providers unless pinned.
- Usage rows with characters and cost. The API never returns keys.
- Web:
  - the key field is never rendered back;
  - "Kiểm tra" plays the sample;
  - the voice picker filters.

## Done
Done checklist from the README. Write `docs/tasks/TASK-040.report.md` and `docs/tasks/TASK-040.done`.
