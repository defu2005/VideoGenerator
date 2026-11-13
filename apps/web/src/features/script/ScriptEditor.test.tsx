import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Script } from "@vg/shared";
import { ScriptEditor, scriptMetrics } from "./ScriptEditor";

const initialScript: Script = {
  title: "Test script",
  hook: "",
  sections: [{
    id: "opening",
    heading: "Opening",
    narration: Array.from({ length: 150 }, () => "word").join(" "),
    visualQueries: { primary: "Notebook", alternatives: [] },
    visualNotes: "A notebook on a desk",
    musicMood: "reflective",
    energy: "medium",
    estDurationSec: 60,
  }],
  outro: "",
  music: { mood: "reflective", energy: "medium", keywords: ["piano"] },
};

describe("ScriptEditor", () => {
  it("calculates duration and supports adding, reordering, removing, and saving sections", async () => {
    expect(scriptMetrics(initialScript)).toEqual({ words: 150, durationSec: 60 });
    const onSave = vi.fn(async (_script: Script) => undefined);
    render(<ScriptEditor
      initialValue={initialScript}
      targetDurationSec={120}
      disabled={false}
      onChange={() => undefined}
      onSave={onSave}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Thêm phần" }));
    const headings = screen.getAllByLabelText("Tiêu đề phần");
    fireEvent.change(headings[1], { target: { value: "Next" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Lên" })[1]);
    expect(screen.getAllByText("Next", { selector: "legend" })[0]).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.sections[0].heading).toBe("Next");
    expect(saved.sections[0].estDurationSec).toBe(0);

    fireEvent.change(screen.getAllByLabelText("Câu tìm hình chính (tiếng Anh)")[0], { target: { value: "cinematic notebook" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].sections[0].visualQueries.primary).toBe("cinematic notebook");

    fireEvent.click(screen.getAllByRole("button", { name: "Xóa phần" })[1]);
    expect(screen.getAllByLabelText("Tiêu đề phần")).toHaveLength(1);
  });
});
