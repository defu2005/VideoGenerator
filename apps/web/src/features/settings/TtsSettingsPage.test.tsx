import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { TtsSettingsPage } from "./TtsSettingsPage";

const SECRET = "super-secret-key-should-never-render";

afterEach(() => vi.unstubAllGlobals());

describe("TtsSettingsPage", () => {
  it("never renders a stored key, plays a check sample, and filters voices", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/settings/tts/preview") && init?.method === "POST") {
        return jsonResponse({ url: "/api/settings/tts/samples/abc", timingSource: "provider", providerId: "edge-tts", characters: 12, cached: false });
      }
      if (url.includes("/tts/voices")) {
        return jsonResponse({
          voices: [
            { language: "vi", gender: "female", name: "vi-VN-HoaiMyNeural", multilingual: false },
            { language: "vi", gender: "male", name: "vi-VN-NamMinhNeural", multilingual: false },
          ],
        });
      }
      return jsonResponse({
        settings: {
          defaultProvider: "edge-tts",
          defaultVoice: "",
          defaultRate: "+0%",
          pricesPerMillion: {},
          geminiModel: "",
          elevenModel: "",
          openaiModel: "",
          piperBinary: "",
          piperModelsDir: "",
          vieneuTemplate: "",
        },
        providers: [
          {
            id: "edge-tts",
            label: "Edge",
            kind: "cli",
            configured: true,
            paid: false,
            wordTimings: true,
            pricePerMillion: 0,
            languages: ["vi", "en"],
            apiKey: SECRET,
          },
          {
            id: "google_cloud",
            label: "Google Cloud",
            kind: "http",
            configured: true,
            paid: true,
            wordTimings: true,
            pricePerMillion: 16,
            languages: ["vi"],
            apiKey: SECRET,
          },
        ],
      });
    }));

    renderWithProviders(<TtsSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Giọng đọc (TTS)" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
    expect((screen.getByLabelText("API key Google Cloud") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra Edge" }));
    await waitFor(() => expect(screen.getByTestId("tts-sample")).toHaveAttribute("src", "/api/settings/tts/samples/abc"));

    expect(screen.getByRole("button", { name: "Nghe thử vi-VN-HoaiMyNeural" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lọc giới tính giọng"), { target: { value: "male" } });
    expect(screen.queryByRole("button", { name: "Nghe thử vi-VN-HoaiMyNeural" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nghe thử vi-VN-NamMinhNeural" })).toBeInTheDocument();
  });
});
