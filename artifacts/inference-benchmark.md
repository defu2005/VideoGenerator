# Inference benchmark — llama3.2:1b

Measured on the Cursor Cloud Agent VM, 2026-11-04 11:22 Asia/Bangkok (UTC+7).

- Ollama 0.40.14, API `127.0.0.1:11434`
- Model `llama3.2:1b` (about 1.3 GB on disk)
- CPU only, 4 vCPU, no GPU
- Request shape: `POST /api/generate`, `stream: false`, `temperature: 0.2`, `num_predict: 80`
- Token rate is Ollama `eval_count / eval_duration` (generation only, excluding prompt eval)

## Sequential Vietnamese prompts

| # | Wall clock (s) | Ollama total (s) | Model load (s) | Prompt tokens | Generated tokens | Tokens/s | CPU during request | MemAvailable after |
|---|----------------|------------------|----------------|---------------|------------------|----------|--------------------|--------------------|
| 1 | 3.807 | 3.693 | 1.796 | 39 | 70 | 40.69 | 73.2% | 2685 MiB |
| 2 | 1.202 | 1.099 | 0.001 | 40 | 44 | 43.02 | 97.1% | 2687 MiB |
| 3 | 2.205 | 2.047 | 0.001 | 44 | 80 | 41.05 | 95.9% | 2685 MiB |
| 4 | 2.002 | 1.952 | 0.001 | 36 | 71 | 38.22 | 99.0% | 2681 MiB |
| 5 | 0.401 | 0.329 | 0.001 | 43 | 11 | 46.21 | 95.6% | 2677 MiB |

The first call loaded weights. MemAvailable dropped by about 1864 MiB (4549 MiB to 2685 MiB) and then stayed flat, so the resident model is roughly 1.8 GiB.

CPU is the percentage of all cores busy (`/proc/stat` idle delta) while the request ran. With 4 cores, ~95% means the machine was nearly saturated.

### Prompt and response notes

1. Prompt: `Xin chào, hãy giới thiệu bản thân trong hai câu.` Response was a short Vietnamese self-introduction (longer than two sentences).
2. Prompt: `Giải thích ngắn gọn máy ảo là gì, bằng tiếng Việt.` Response defined a virtual machine in Vietnamese.
3. Prompt: `Kể tên ba thành phố lớn của Việt Nam và một đặc điểm của mỗi thành phố.` Response started with Hà Nội and TP.HCM and was cut at `num_predict` 80.
4. Prompt: `Viết một câu chúc buổi sáng lịch sự.` Response included a polite morning greeting.
5. Prompt: `1 kilôgam bằng bao nhiêu gam? Chỉ trả lời bằng số và đơn vị.` Response: `1 kilôgam = 1.000 gam`.

All five calls returned HTTP 200 with a non-empty `response`. No request failed.

## Concurrent requests

Two `POST /api/generate` calls were issued together (`num_predict` 40). `OLLAMA_NUM_PARALLEL=1`, so Ollama queues the second call on one runner.

| Call | OK | Wall clock (s) | Generated tokens |
|------|----|----------------|------------------|
| Đếm từ một đến năm bằng tiếng Việt. | yes | 1.235 | 40 |
| Dịch sang tiếng Việt: good morning. | yes | 0.214 | 6 |

Both finished. Combined wall clock was 1.24 s. The second call was short and completed while the first was still generating, which matches queued CPU inference rather than two full parallel model copies. Quality on the counting prompt was weak (the list drifted after "ba").

## Limits observed

- No GPU. Steady generation is about 38–46 tokens/s on this 4 vCPU guest.
- Cold start adds about 1.8 s of load time.
- RAM headroom after the model is loaded is about 2.6 GiB available. A second large model was not loaded.
- Swap is absent, so a larger model can be killed by the OOM killer.
