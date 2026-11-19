# TASK-133 — Small hardening: TOTP QR code, edge-tts version check 🔧

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** S. **Migration:** none. **New dependency:** none; vendor one MIT file, see below.
**Depends on:** nothing. It may run beside any task that does not edit `features/account/AccountPage.tsx` or `providers/tts/edgeTts.ts`.
**Source:** "Known follow-ups" in the handoff memory (no TOTP QR; edge-tts not pinned).

## Why

- **TOTP has no QR code.** Two-step setup (`apps/web/src/features/account/AccountPage.tsx` ~line 109–151) shows the secret text and an `otpauth://` link. On a desktop browser the user has to type the secret into the phone by hand. Every authenticator app expects a QR code.
- **edge-tts is not version-checked.** `lib/config.ts` (~line 30–48) finds the `edge-tts` binary, and `providers/tts/edgeTts.ts` only reports "not installed". Microsoft changes the Edge endpoint from time to time, and old edge-tts versions then fail with confusing errors. Nothing tells the user that the version is the cause or what to run.

## Read first

- `AccountPage.tsx` (the setup state `{ uri, codes }`, `secretFromUri`) and the account API helpers it imports.
- `apps/server/src/providers/tts/edgeTts.ts` (spawn, error mapping `TTS_BINARY_MISSING`), `lib/config.ts` (binary discovery), the TTS settings page and API from TASK-040 (provider health and preview), and `/api/health`.

## Build

1. **QR code for TOTP (web only).**
   - Vendor **Project Nayuki's QR Code generator**, TypeScript version (MIT), as one file `apps/web/src/lib/vendor/qrcodegen.ts`.
   - Keep its copyright and licence header untouched, and add an entry to `docs/THIRD_PARTY.md`.
   - Do not `npm install` anything.
   - Render the `totpURI` as an inline SVG (error correction M, quiet zone 4, `currentColor` on a light tile so it scans in dark mode too) above the secret text.
   - Keep the text secret and the link as fallbacks, and keep the label "Quét mã QR bằng ứng dụng xác thực".
   - The QR is built in the browser only: never send the URI or the secret to any server or third-party QR service, and never log it.
2. **edge-tts version check (server).**
   - Add `edgeTtsVersion()`: run the found binary with `--version`, 5 s timeout, parse `x.y.z`, and cache the result per binary path for 10 minutes.
   - Keep one constant `EDGE_TTS_MIN_VERSION` with a comment saying how to raise it: when Microsoft breaks old clients, bump it and add a changelog line. Start it at the version installed on the user's machine as reported by the binary. If you cannot run it, set it to the version in the latest edge-tts release notes that you can cite, and say which one in the report.
   - Show the result on the TTS settings page and in `/api/health` details: version, path, "OK" or "cũ — chạy: `pip install -U edge-tts`".
   - When an edge-tts synthesis fails and the version is below the minimum, map the error to a new code `TTS_BINARY_OUTDATED` (not retryable). Its Vietnamese message carries the exact command.
   - The provider failover from TASK-040/127 treats this code like "not configured", so another TTS provider can take over.
   - The app never runs pip itself.

## Mã nguồn mở có sẵn (open source)

- **Project Nayuki QR Code generator** (MIT): https://github.com/nayuki/QR-Code-generator. One self-contained TypeScript file and the standard choice. Copy it with attribution; do not add an npm package.
- **edge-tts** (rany2/edge-tts, LGPL-3.0): only called as an external CLI, as today. Do not copy its code.

## Rules

- README rules 1–11. Tests never run the real `edge-tts`; use a fake binary or a stubbed spawn.
- No secret or TOTP URI in logs, test snapshots or the report.

## Tests

- **QR:**
  - the vendored encoder turns a known `otpauth://` string into the expected module count for its version;
  - the account page renders an SVG when setup data exists;
  - the fallback text is still present;
  - nothing is fetched.
- **edge-tts:**
  - `--version` output parsing (normal, with a prefix, garbage → unknown);
  - the cache holds;
  - below the minimum → health shows "cũ" with the command;
  - a failure on an old version → `TTS_BINARY_OUTDATED`;
  - an unknown version → no false "outdated".

## Done

- [ ] vendored QR + account page
- [ ] edge-tts version check, health, settings display, error code
- [ ] tests; server + web suites; typecheck; build
- [ ] `docs/THIRD_PARTY.md`; user guide (Tài khoản 2FA, TTS); changelog
- [ ] report → `docs/tasks/TASK-133.done`
