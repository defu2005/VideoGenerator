import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BriefSettings } from "@vg/shared";
import { BriefFields } from "./BriefFields";

const settings = {
  language: "vi",
  targetDurationSec: 120,
  aspectRatio: "16:9",
  platform: "youtube",
  style: "explainer",
  tone: "neutral",
  audience: "general",
  wordsPerMinute: 150,
  sceneDurationSec: 7,
  visualStyle: "mixed",
  subtitles: { enabled: true, maxCharsPerLine: 42 },
  music: { enabled: true, volume: 0.15 },
  stageExecutors: {},
  autoRender: false,
  userSet: [],
  budget: { mode: "BALANCED" as const },
} as BriefSettings;

describe("BriefFields format cards", () => {
  it("shows recipe descriptions and reports the chosen card", () => {
    const onChange = vi.fn();
    render(<BriefFields topic="Hố đen" settings={settings} onChange={onChange} onReset={() => undefined} />);
    expect(screen.getByRole("radiogroup", { name: "Mẫu video" })).toBeInTheDocument();
    expect(screen.getByText(/Một câu hỏi mở/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Danh sách/ }));
    expect(onChange).toHaveBeenCalledWith("format", "listicle");
  });
});
