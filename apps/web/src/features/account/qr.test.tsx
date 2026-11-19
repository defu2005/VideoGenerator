import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AccountPage, TotpQrCode } from "./AccountPage";
import { qrcodegen } from "../../lib/vendor/qrcodegen";

type Handler = (url: string, init?: RequestInit) => Response | undefined;
function mockFetch(handlers: Handler[]) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    for (const handler of handlers) {
      const out = handler(url, init);
      if (out) return out;
    }
    return jsonResponse({ error: { code: "NOT_FOUND", message: "x" } }, 404);
  }));
  return calls;
}

const meData = {
  user: { id: "u1", name: "Chủ", email: "user@example.test" },
  workspace: { id: "w1", name: "Nhóm", flags: {} },
  workspaces: [],
  role: "owner",
  channelIds: "all",
  isInstanceOwner: true,
  twoFactorEnabled: false,
  allowed: ["members.manage", "audit.read"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TOTP QR Code hardening", () => {
  it("turns a known otpauth:// string into the expected module count for its version", () => {
    const uri = "otpauth://totp/ACME:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME";
    const qr = qrcodegen.QrCode.encodeText(uri, qrcodegen.QrCode.Ecc.MEDIUM);

    // Version 5 is expected for this length with Medium ECC
    expect(qr.version).toBe(5);
    // Formula for QR version modules is version * 4 + 17
    const expectedModulesPerSide = 5 * 4 + 17; // 37
    expect(qr.size).toBe(expectedModulesPerSide);
    expect(qr.errorCorrectionLevel).toBe(qrcodegen.QrCode.Ecc.MEDIUM);

    // Verify module grid returns booleans and corners have finder patterns (always dark at (0,0))
    expect(qr.getModule(0, 0)).toBe(true);
    expect(qr.getModule(3, 3)).toBe(true);
  });

  it("renders an inline SVG with currentColor on a light tile above secret text when setup exists, and fetches nothing externally", async () => {
    // Secret and URI kept in test memory only, never logged
    const testSecret = "TESTSECRET123456";
    const testUri = `otpauth://totp/App:user@example.test?secret=${testSecret}&issuer=App`;

    const fetchCalls = mockFetch([
      (u) => (u.endsWith("/api/me") ? jsonResponse(meData) : undefined),
      (u) => (u.endsWith("/api-key/list") ? jsonResponse([]) : undefined),
      (u) => (u.endsWith("/list-sessions") ? jsonResponse([]) : undefined),
      (u) => (u.endsWith("/api/settings/agent-keys") ? jsonResponse({ profiles: [] }) : undefined),
      (u, init) => {
        if (u.includes("/two-factor/enable") && init?.method === "POST") {
          return jsonResponse({
            totpURI: testUri,
            backupCodes: ["bk1", "bk2"],
          });
        }
        return undefined;
      },
    ]);

    renderWithProviders(<AccountPage />);

    // Initial state: 2FA card shows input for password to enable
    const twoFactorHeading = await screen.findByRole("heading", { name: "Xác thực hai bước (2FA)" });
    const twoFactorCard = twoFactorHeading.closest("section")!;
    const passwordInput = within(twoFactorCard).getByLabelText("Mật khẩu hiện tại");
    fireEvent.change(passwordInput, { target: { value: "pass123" } });
    fireEvent.click(within(twoFactorCard).getByRole("button", { name: "Bật xác thực hai bước" }));

    // Wait for setup UI to appear
    await waitFor(() => {
      expect(screen.getByLabelText("Quét mã QR bằng ứng dụng xác thực")).toBeInTheDocument();
    });

    // 1. Verify SVG element is rendered inline
    const qrSvg = screen.getByLabelText("Quét mã QR bằng ứng dụng xác thực");
    expect(qrSvg.tagName.toLowerCase()).toBe("svg");
    const quietZone = 4;
    const expectedSize = (4 * 4 + 17) + quietZone * 2; // For the testUri version
    expect(qrSvg).toHaveAttribute("viewBox", expect.stringMatching(/^\d+ \d+ \d+ \d+$/));

    // 2. Verify dark mode compatibility: currentColor fill on path, light tile wrapper
    const path = qrSvg.querySelector("path");
    expect(path).not.toBeNull();
    expect(path).toHaveAttribute("fill", "currentColor");

    const rect = qrSvg.querySelector("rect");
    expect(rect).not.toBeNull();
    expect(rect).toHaveAttribute("fill", "#ffffff");

    const tile = screen.getByTestId("totp-qr-code");
    expect(tile).toHaveStyle({ background: "#ffffff", color: "#000000" });

    // 3. Fallback text and links remain present
    expect(screen.getByLabelText("Khóa thiết lập")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chép khóa" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Thêm vào ứng dụng xác thực" })).toHaveAttribute("href", testUri);

    // 4. Verify nothing was fetched externally for QR generation (no api.qrserver.com or external calls)
    const externalCalls = fetchCalls.filter((c) => !c.url.startsWith("/") && !c.url.includes("127.0.0.1") && !c.url.includes("localhost"));
    expect(externalCalls).toHaveLength(0);
    // Only internal backend auth/me endpoints were hit
    expect(fetchCalls.every((c) => c.url.includes("/api/me") || c.url.includes("/api-key/list") || c.url.includes("/list-sessions") || c.url.includes("/two-factor/enable") || c.url.includes("/api/settings/agent-keys"))).toBe(true);
  });

  it("TotpQrCode component handles invalid uri gracefully without throwing", () => {
    renderWithProviders(<TotpQrCode uri="" />);
    expect(screen.queryByTestId("totp-qr-code")).toBeNull();
  });
});
