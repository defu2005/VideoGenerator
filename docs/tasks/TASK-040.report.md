# TASK-040 report — Nhiều nguồn TTS và mốc thời gian từng từ

## Việc đã làm

Thêm Google Cloud, Gemini, ElevenLabs, OpenAI, FPT.AI, Viettel AI, Piper và VieNeu bên cạnh Edge TTS và mock. Mỗi nhà cung cấp nằm một file, key nằm trong TokenVault (`tts.<id>.apiKey`), không trả về API và không ghi log. Văn bản dài được cắt theo câu dưới `maxCharsPerRequest`, nối bằng ffmpeg, mốc thời gian cộng dồn. Nếu nhà cung cấp không trả mốc từ, hệ thống căn bằng CLI nhận dạng giọng (khi đã cấu hình ở TASK-037) rồi mới ước lượng theo khoảng lặng và trọng số âm tiết. Câu thoại luôn dựng từ danh sách từ.

Trang **Giọng đọc (TTS)** ở `/settings/tts`: một thẻ mỗi nhà cung cấp, ô mật khẩu không hiện lại key, giá USD / 1 triệu ký tự, nút Kiểm tra phát mẫu, duyệt giọng theo ngôn ngữ và giới tính. Hồ sơ và dự án chọn nhà cung cấp + giọng và ghi “Có mốc thời gian từng từ” khi catalog có mốc. Mức dùng hiện số ký tự và tiền TTS trên từng dòng gọi.

## File thay đổi

### Shared
- `packages/shared/src/tts/catalog.ts` — catalog, giá mặc định, chính sách ECO, chuỗi dự phòng
- `packages/shared/src/tts/timing.ts` — cắt câu, lệch thời gian, căn từ, ước lượng âm tiết
- `packages/shared/src/tts/requests.ts` — URL, header, body và parser từng nhà cung cấp
- `packages/shared/src/schemas/tts.ts` — cài đặt app, trạng thái nhà cung cấp, preview
- `packages/shared/src/schemas/voice.ts` — `words`, `timingSource`, `wordTimings`
- `packages/shared/src/schemas/project.ts`, `schemas/profile.ts` — giọng có `provider`, `model`, `style`
- `packages/shared/src/schemas/job.ts`, `schemas/usage.ts` — `characters`, `costUsd` trên từng lần gọi
- `packages/shared/src/index.ts` — export
- `packages/shared/test/tts.test.ts`

### Server
- `apps/server/src/providers/tts/` — `googleCloudTts.ts`, `geminiTts.ts`, `elevenLabsTts.ts`, `openaiTts.ts`, `fptAiTts.ts`, `viettelAiTts.ts`, `piperTts.ts`, `vieneuTts.ts`, `align.ts`, `chunk.ts`, `context.ts`, `http.ts`; cập nhật `registry.ts`, `types.ts`, `edgeTts.ts`, `mockTts.ts`
- `apps/server/src/settings/tts.ts`, `apps/server/src/api/ttsSettings.ts`
- `apps/server/src/api/voice.ts`, `apps/server/src/stages/voice/voiceExecutor.ts`, `apps/server/src/app.ts`, `apps/server/src/services/usageService.ts`, `apps/server/src/lib/config.ts`, `apps/server/src/db/schema.ts`
- Migration `apps/server/drizzle/0037_tts_word_timings.sql` (+ snapshot, journal). Lần `drizzle-kit generate` thứ hai in “No schema changes, nothing to migrate”
- Tests: `apps/server/test/ttsSettings.test.ts`, `apps/server/test/usage.test.ts`; `apps/server/test/edgeTts.test.ts` nhận thêm `timingSource: "estimated"` và `characters`

### Web
- `apps/web/src/features/settings/TtsSettingsPage.tsx` + test
- `apps/web/src/App.tsx`, `apps/web/src/components/layout/AppLayout.tsx`, `apps/web/src/index.css`
- `apps/web/src/features/projects/ProjectFormFields.tsx`, `EditProjectDialog.tsx`
- `apps/web/src/features/profiles/ProfileDetailPage.tsx`
- `apps/web/src/features/voice/VoicePanel.tsx`, `apps/web/src/features/usage/ProjectUsagePanel.tsx`
- `apps/web/src/services/voiceApi.ts`

## Số test

- shared: 283
- mcp: 12
- server: 596
- web: 117

`npm run typecheck`, `npm run build` và `npm test --workspaces` đều qua. Không đổi `package.json` / `package-lock.json`. File đổi không có NUL và là UTF-8.

## Lệch so với hướng dẫn

- Id nhà cung cấp Edge giữ `edge-tts`, mock giữ `mock`, để cấu hình và track cũ không gãy. Chuỗi dự phòng dùng `edge-tts`.
- Gemini dùng field REST hiện tại `speechConfig.voiceConfig.voice` và `speechMetadata.style`. `prebuiltVoiceConfig.voiceName` trong hướng dẫn là dạng nhiều người nói cũ hơn.
- Google gửi `X-Goog-Api-Key` trên header, không đưa key vào URL. SSML đặt `<mark>` trước từng từ; Google có thể bỏ sự kiện khi các mark đứng sát nhau.
- FPT.AI gửi cả `api_key` và `api-key`. Viettel gửi `token` ở header và trong JSON.
- Edge chỉ có mốc từ khi stdout có dòng JSON `WordBoundary`. CLI edge-tts thông thường không in dòng đó, nên mốc rơi xuống căn giọng hoặc ước lượng. Catalog vẫn đánh dấu `wordTimings: true` vì parser đã có.
- Giá / 1 triệu ký tự là chỗ giữ chỗ, sửa được: Google 16, Gemini 10, ElevenLabs 30, OpenAI 15, FPT 8.5 (ước lượng từ gói VND), Viettel 0 vì không có giá USD công khai. Giới tính giọng OpenAI và Gemini là gần đúng hoặc không rõ. Danh sách tĩnh Google là Neural2 / Wavenet / Standard; Chirp3-HD chỉ lọc từ danh sách sống khi có key.
- `TTS_PROVIDER` nhận mọi id trong catalog cộng `mock` và `edge-tts`, và chỉ là mặc định ban đầu khi chưa lưu cài đặt.
- Test Edge cũ được cập nhật vì `synthesize` bắt buộc trả `timingSource` và `characters`.

## Chưa làm

- Chưa mở trang trên trình duyệt thật (phiên này không có công cụ trình duyệt). Trang và nút Kiểm tra được kiểm bằng vitest.
- Bản lồng tiếng dịch (`translationService`) vẫn gọi `synthesize` trực tiếp và không ghi cột `words`. Cột mới có default nên insert cũ vẫn chạy; track dịch không có mốc từ.
- Không gọi API hoặc CLI TTS thật trong test.
- App không đọc file credential Google và không đọc `~/.gemini/oauth_creds.json`.
- Hướng dẫn người dùng (`docs/user-guide/`) chưa cập nhật. Checklist nói việc đó áp dụng từ TASK-048.
