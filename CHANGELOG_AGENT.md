# Agent Modification Log (CHANGELOG_AGENT.md)

Tài liệu này ghi lại toàn bộ các chỉnh sửa mã nguồn và cấu hình do Hermes Agent thực hiện trên repository `videoGenerator`.

---

## [2026-11-09] Khắc phục lỗi Quota False Match và Khởi tạo Edge-TTS trên Windows

### 1. `packages/shared/src/llmQuota/live.ts`
- **Vị trí:** Dòng 308–315, hàm `callTargetsOmniProvider(provider, model, omniProvider)`
- **Lý do:** Khi so sánh prefix của model OmniRoute (ví dụ: `sopen`) với provider connection (ví dụ: `grok-cli`), cả hai đều trả về `null` trong `appProviderForOmniroute`. Biểu thức `null === null` thành `true`, khiến mọi model unmapped bị gán nhầm vào `grok-cli` đang cạn quota tuần, gây lỗi `LLM_QUOTA_WAIT`.
- **Nội dung thay đổi:**
  ```diff
  --- a/packages/shared/src/llmQuota/live.ts
  +++ b/packages/shared/src/llmQuota/live.ts
  @@ -308,7 +308,9 @@ export function callTargetsOmniProvider(provider: string, model: string, omniPro
       const slash = model.indexOf("/");
       if (slash <= 0) return false;
       const prefix = model.slice(0, slash).toLowerCase();
  -    return prefix === wanted || appProviderForOmniroute(prefix) === appProviderForOmniroute(wanted);
  +    const appPrefix = appProviderForOmniroute(prefix);
  +    const appWanted = appProviderForOmniroute(wanted);
  +    return prefix === wanted || (appPrefix !== null && appWanted !== null && appPrefix === appWanted);
     }
  ```

### 2. `packages/shared/package.json`
- **Vị trí:** Dòng 8–15, trường `"exports"`
- **Lý do:** Bổ sung export conditions cho `"require"` và `"default"` để các module CommonJS/Node tsx có thể nạp `@vg/shared` trực tiếp mà không báo lỗi `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Nội dung thay đổi:**
  ```diff
  --- a/packages/shared/package.json
  +++ b/packages/shared/package.json
  @@ -8,7 +8,9 @@
     "exports": {
       ".": {
         "types": "./dist/index.d.ts",
  -      "import": "./dist/index.js"
  +      "import": "./dist/index.js",
  +      "require": "./dist/index.js",
  +      "default": "./dist/index.js"
       }
     },
  ```

### 3. `apps/server/src/lib/config.ts`
- **Vị trí:** Dòng 30–35, hàm `resolveEdgeTtsPath`
- **Lý do:** Thư mục cài đặt Python trong `LocalAppData` trên máy là `pythoncore-3.15-64` (viết thường). Regex cũ `/^Python/` phân biệt hoa thường nên không quét được thư mục này. Thêm flag `i` (`/^Python/i`) để nhận diện được đường dẫn cài đặt Python.
- **Nội dung thay đổi:**
  ```diff
  --- a/apps/server/src/lib/config.ts
  +++ b/apps/server/src/lib/config.ts
  @@ -30,8 +30,8 @@ function resolveEdgeTtsPath(env: NodeJS.ProcessEnv = process.env): string {
     for (const entry of pathEntries) candidates.push(join(entry, "edge-tts"), join(entry, "edge-tts.exe"));
     if (process.platform === "win32") {
       for (const [root, versions] of [
  -      [env.APPDATA, /^Python3/],
  -      [env.LOCALAPPDATA, /^Python/],
  +      [env.APPDATA, /^Python3/i],
  +      [env.LOCALAPPDATA, /^Python/i],
       ] as const) {
  ```

### 4. `apps/server/src/providers/tts/edgeTts.ts`
- **Vị trí:** Dòng 185–225, hàm `runCli`
- **Lý do:** Trên Windows, cơ chế bảo vệ ứng dụng (Application Control / AppLocker) chặn thực thi các file binary `.exe` không được ký số trong thư mục `AppData\Local\Python\...\Scripts\edge-tts.exe`. Bổ sung cơ chế fallback tự động gọi qua `python -m edge_tts` (tiến trình `python.exe` hợp lệ) khi chạy trên Windows.
- **Nội dung thay đổi:**
  ```diff
  --- a/apps/server/src/providers/tts/edgeTts.ts
  +++ b/apps/server/src/providers/tts/edgeTts.ts
  @@ -203,7 +204,7 @@ export class EdgeTtsProvider implements TtsProvider {
           clearTimeout(timer);
           signal?.removeEventListener("abort", onAbort);
           if (code === 0) resolve(`${stdout}\n${stderr}`.trim());
  -        else reject(new Error(stderr || stdout || `edge-tts exited with code ${code}`));
  +        else reject(new Error(stderr || stdout || `${bin} exited with code ${code}`));
         });
  +    try {
  +      return await run(this.binaryPath || "edge-tts", args);
  +    } catch (err) {
  +      if (isWin) {
  +        try {
  +          return await run("python", ["-m", "edge_tts", ...args]);
  +        } catch {
  +          throw err;
  +        }
  +      }
  +      throw err;
  +    }
  ```
