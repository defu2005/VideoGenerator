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
  it("keeps an inherited agent setting blank and reports explicit overrides and resets", () => {
    const onChange = vi.fn(), onReset = vi.fn();
    const view = render(<BriefFields topic="Ảnh cảnh" settings={settings} onChange={onChange} onReset={onReset} />);
    expect(screen.getByRole("combobox", { name: "Ai xử lý bước tìm ảnh" })).toHaveValue("");
    fireEvent.change(screen.getByRole("combobox", { name: "Ai xử lý bước tìm ảnh" }), { target: { value: "agent" } });
    expect(onChange).toHaveBeenCalledWith("stageExecution.VISUAL_SEARCH", "agent");
    view.rerender(<BriefFields topic="Ảnh cảnh" settings={{ ...settings, stageExecution: { VISUAL_SEARCH: "agent" }, agentWaitMinutes: 45 }} onChange={onChange} onReset={onReset} />);
    expect(screen.getByRole("spinbutton", { name: "Thời gian chờ agent (phút)" })).toHaveValue(45);
    fireEvent.change(screen.getByRole("combobox", { name: "Ai xử lý bước tìm ảnh" }), { target: { value: "" } });
    expect(onReset).toHaveBeenCalledWith("stageExecution.VISUAL_SEARCH");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Thời gian chờ agent (phút)" }), { target: { value: "" } });
    expect(onReset).toHaveBeenCalledWith("agentWaitMinutes");

    expect(screen.getByRole("combobox", { name: "Ai xử lý bước kịch bản" })).toHaveValue("");
    fireEvent.change(screen.getByRole("combobox", { name: "Ai xử lý bước kịch bản" }), { target: { value: "agent" } });
    expect(onChange).toHaveBeenCalledWith("stageExecution.SCRIPT", "agent");
    expect(screen.getByRole("combobox", { name: "Ai xử lý bước nghiên cứu" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Ai xử lý bước tìm nhạc" })).toHaveValue("");
  });
  it("shows recipe descriptions and reports the chosen card", () => {
    const onChange = vi.fn();
    render(<BriefFields topic="Hố đen" settings={settings} onChange={onChange} onReset={() => undefined} />);
    expect(screen.getByRole("radiogroup", { name: "Mẫu video" })).toBeInTheDocument();
    expect(screen.getByText(/Một câu hỏi mở/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Danh sách/ }));
    expect(onChange).toHaveBeenCalledWith("format", "listicle");
  });
});
