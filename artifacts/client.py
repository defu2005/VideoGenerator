#!/usr/bin/env python3
"""Call the remote Ollama endpoint from the command line.

Environment:
  OLLAMA_BASE_URL  HTTPS origin, no trailing path (example: https://name.trycloudflare.com)
  OLLAMA_TOKEN     Bearer token. Never commit this value.
"""

import json
import os
import sys
import urllib.error
import urllib.request

MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:1b")
TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "180"))


def main() -> int:
    prompt = " ".join(sys.argv[1:]).strip()
    if not prompt:
        print("Usage: python client.py <prompt>", file=sys.stderr)
        return 2
    base = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
    token = os.environ.get("OLLAMA_TOKEN", "")
    if not base or not token:
        print("Set OLLAMA_BASE_URL and OLLAMA_TOKEN.", file=sys.stderr)
        return 2
    body = json.dumps(
        {"model": MODEL, "prompt": prompt, "stream": False},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        base + "/api/generate",
        data=body,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}: {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Connection error: {exc.reason}", file=sys.stderr)
        return 1
    except TimeoutError:
        print(f"Timed out after {TIMEOUT} seconds.", file=sys.stderr)
        return 1
    text = payload.get("response")
    if text is None:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 1
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
