# Remote Ollama on a Cursor Cloud Agent VM

Tài liệu kết nối đầy đủ, bằng tiếng Việt: [KET-NOI.md](KET-NOI.md). File đó gồm sơ đồ, biến môi trường Windows, Python, PowerShell, curl, hợp đồng `/api/generate` và `/api/chat`, mã lỗi, cách bật lại sau khi VM dừng, và phần dữ liệu nào còn sau khi máy bị thay.

This directory is a small client and the scripts that keep a CPU copy of `llama3.2:1b` behind an authenticated HTTPS tunnel. Inference runs in Ollama on the VM. Later prompts do not go through the Cursor Agent.

The VM is not a permanent server. Sleep, recycle, or a new Cloud Agent session stops the process and drops the public URL. Plan on starting the services again after the machine is back.

## What is running

| Piece | Bind | Role |
| --- | --- | --- |
| Ollama 0.40.14 | `127.0.0.1:11434` | Model runtime. Not reachable from the internet. |
| `scripts/inference_proxy.py` | `127.0.0.1:11435` | Requires `Authorization: Bearer <token>` and forwards only `/api/generate`, `/api/chat`, `/api/tags`, `/api/ps`, `/api/version`. |
| `cloudflared` quick tunnel | ephemeral `*.trycloudflare.com` | HTTPS to the proxy. The tunnel itself has no Cloudflare Access policy; the proxy token is the lock. |

Weights live in `/workspace/.ollama` via `OLLAMA_MODELS`. That directory is gitignored.

## Call it from Windows

On the VM, after `artifacts/start-services.sh`, open `.secrets/inference.env` (mode `0600`, gitignored). Copy the two values into your Windows session. Do not commit that file and do not paste the token into git, screenshots, or the artifact files.

PowerShell:

```powershell
$env:OLLAMA_BASE_URL = "https://<name>.trycloudflare.com"
$env:OLLAMA_TOKEN = "<paste from .secrets/inference.env>"
powershell -File .\artifacts\client.ps1 "Xin chào, hãy giới thiệu bản thân."
```

Python 3 (no extra packages):

```powershell
$env:OLLAMA_BASE_URL = "https://<name>.trycloudflare.com"
$env:OLLAMA_TOKEN = "<paste from .secrets/inference.env>"
python .\artifacts\client.py "Xin chào, hãy giới thiệu bản thân."
```

Equivalent HTTP call:

```http
POST /api/generate
Authorization: Bearer <OLLAMA_TOKEN>
Content-Type: application/json

{"model":"llama3.2:1b","prompt":"Xin chào, hãy giới thiệu bản thân.","stream":false}
```

A missing or wrong token returns HTTP 401. The clients surface HTTP errors, connection failures, and timeouts (`OLLAMA_TIMEOUT`, default 180 seconds).

## Restart after the VM resumes

From the repo root, on the VM:

```bash
bash artifacts/start-services.sh
```

The script:

1. Creates `.secrets/token` only when that file is missing.
2. Starts `ollama serve` if `127.0.0.1:11434` is down.
3. Downloads `llama3.2:1b` only when `ollama list` does not already show it and at least about 3 GB is free.
4. Restarts the proxy and the quick tunnel.
5. Rewrites `.secrets/inference.env` with the new base URL and the existing token.

Stop everything without deleting weights:

```bash
bash artifacts/stop-services.sh
```

Each quick tunnel gets a new hostname. Update `OLLAMA_BASE_URL` on Windows from the new `.secrets/inference.env`. The script prints the public URL and does not print the token.

## What survives recycling

| Data | Survives a git commit | Survives VM recycle |
| --- | --- | --- |
| `artifacts/*.py`, `*.ps1`, `*.md`, `*.sh`, `scripts/inference_proxy.py` | Yes, once committed | Yes, because they come back with the git checkout |
| `.secrets/` (token, current URL, logs) | No (gitignored) | No. A new VM does not keep this directory unless the disk snapshot still has it. `start-services.sh` mints a new token if the file is gone. |
| `.ollama/` model blobs (~1.3 GB) | No (gitignored) | No for a fresh VM created from the repository. The same VM, after a short resume, often still has the files because they sit on the root disk. Do not treat that as durable storage. The start script pulls the model again when it is missing. |
| Ollama process, proxy, tunnel URL | No | No. Processes die when the VM stops. The `*.trycloudflare.com` name is not reserved. |
| `/usr/local` Ollama and cloudflared binaries | No | No, unless this environment is snapshotted and new agents boot from that snapshot. Otherwise reinstall both tools before `start-services.sh`. |

Nothing here keeps the endpoint online while the Cloud Agent VM is suspended. Cloudflare quick tunnels are also best-effort and can be rate-limited or shut down by Cloudflare.

## Cost and other limits

- Cursor Cloud Agent compute is billed by Cursor while the VM is running. This setup does not stop that billing.
- Ollama and the model weights are local. There is no per-token charge from Ollama.
- Cloudflare quick tunnels do not need a Cloudflare account. They are not a production SLA. A named tunnel (`cloudflared tunnel login` plus a Cloudflare zone) would be the stable alternative and can add Cloudflare account cost depending on the plan.
- CPU only, about 38–46 tokens/s on the 4 vCPU guest measured in `inference-benchmark.md`. First request pays model load (~1.8 s, ~1.8 GiB RAM).
- `OLLAMA_NUM_PARALLEL=1`. Overlapping requests are queued, not a second copy of the model.
- No swap. Do not pull a larger model unless `artifacts/system-info.txt` is refreshed and free RAM stays comfortable (several GiB above the weight file).
- The proxy allows a small API surface. It is still an open HTTPS URL plus a bearer token. Anyone with the token can spend the VM's CPU. Rotate the token by deleting `.secrets/token` and running `start-services.sh` again.
