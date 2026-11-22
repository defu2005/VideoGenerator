import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScriptDraftPanel } from "./ScriptDraftPanel";
import type { ScriptDraftPayload } from "@vg/shared";

describe("ScriptDraftPanel", () => {
  const mockDraft: ScriptDraftPayload = {
    engineMode: "full",
    inputHash: "test-hash",
    updatedAt: new Date().toISOString(),
    chosenHookId: "h1",
    critiqueStale: false,
    outline: {
      centralQuestion: "Tại sao loài mèo lại thích ngủ?",
      promise: "Khám phá bí mật sinh học đằng sau giấc ngủ của mèo",
      framework: "three_act",
      surprises: [{ fact: "Mèo thực chất ngủ nông 70% thời gian", factIds: ["f1"] }],
      beats: [
        {
          id: "b1",
          sectionKey: "intro",
          targetSec: 15,
          purpose: "hook",
          emotion: "curious",
          concreteMoment: "Mèo ngủ li bì",
          newInformation: "Mèo ngủ nông 70% thời gian",
          opensLoops: ["l1"],
          closesLoops: [],
          factIds: ["f1"],
          visualIntent: "Ảnh mèo ngủ",
        },
      ],
      loops: [{ id: "l1", question: "Tại sao lại ngủ nhiều thế?", opensAtBeatId: "b1", closesAtBeatId: "b1" }],
      setupPayoffs: [],
    },
    hookCandidates: [
      { id: "h1", tactic: "question", text: "Bạn có biết mèo ngủ bao nhiêu tiếng một ngày?", promise: "Bí mật giấc ngủ" },
      { id: "h2", tactic: "cold_open", text: "16 tiếng mỗi ngày, mèo làm gì trong mơ?", promise: "Bí mật giấc mơ" },
      { id: "h3", tactic: "curiosity_gap", text: "Bí mật đáng kinh ngạc đằng sau giấc ngủ của loài mèo.", promise: "Sự thật bất ngờ" },
    ],
    hookAssessments: [
      { hookId: "h1", scores: { curiosity: 4, clarity: 5, accuracy: 4, audienceFit: 4, payoff: 4 } },
      { hookId: "h2", scores: { curiosity: 5, clarity: 4, accuracy: 4, audienceFit: 5, payoff: 4 } },
      { hookId: "h3", scores: { curiosity: 4, clarity: 4, accuracy: 4, audienceFit: 4, payoff: 4 } },
    ],
    critique: {
      total: 85,
      scores: {
        structure: 4,
        hook: 5,
        accuracy: 4,
        ttsNatural: 4,
        visualizable: 4,
        originality: 4,
      },
      hookPaidOff: true,
      unclosedLoops: [],
      sectionIssues: [
        {
          sectionId: "section-1",
          criterion: "structure",
          problem: "Nhịp hơi chậm",
          fix: "Cắt bớt lời dẫn",
        },
      ],
    },
    critiqueHistory: [{ round: 1, total: 85, scores: { structure: 4, hook: 5, accuracy: 4, ttsNatural: 4, visualizable: 4, originality: 4 } }],
  };

  it("renders central question, scores, and hook candidates", () => {
    render(
      <ScriptDraftPanel
        draft={mockDraft}
        onSwitchHook={vi.fn()}
        onRescore={vi.fn()}
      />
    );

    expect(screen.getByText("Tại sao loài mèo lại thích ngủ?")).toBeTruthy();
    expect(screen.getByText("85")).toBeTruthy();
    expect(screen.getByText("Đang dùng")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Dùng hook này" })).toHaveLength(2);
  });

  it("calls onSwitchHook when clicking switch hook button", async () => {
    const handleSwitchHook = vi.fn().mockResolvedValue(undefined);
    render(
      <ScriptDraftPanel
        draft={mockDraft}
        onSwitchHook={handleSwitchHook}
        onRescore={vi.fn()}
      />
    );

    const buttons = screen.getAllByRole("button", { name: "Dùng hook này" });
    fireEvent.click(buttons[0]);
    expect(handleSwitchHook).toHaveBeenCalledWith("h2");
  });

  it("calls onRescore when clicking rescore button", async () => {
    const handleRescore = vi.fn().mockResolvedValue(undefined);
    render(
      <ScriptDraftPanel
        draft={mockDraft}
        onSwitchHook={vi.fn()}
        onRescore={handleRescore}
      />
    );

    const rescoreBtn = screen.getByRole("button", { name: "Chấm lại" });
    fireEvent.click(rescoreBtn);
    expect(handleRescore).toHaveBeenCalled();
  });

  // TASK-146 outline editing (written, not run: no-test rule in force).
  it("shows no outline editors unless the outline is parked and an edit handler is given", () => {
    render(<ScriptDraftPanel draft={mockDraft} onSwitchHook={vi.fn()} onRescore={vi.fn()} outlineAwaiting onApproveOutline={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: "Câu hỏi trung tâm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lưu sửa dàn ý" })).toBeNull();
  });

  it("saves only the changed central question and holds Approve until the edit is saved", async () => {
    const handleEdit = vi.fn().mockResolvedValue(undefined);
    const handleApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <ScriptDraftPanel
        draft={mockDraft}
        onSwitchHook={vi.fn()}
        onRescore={vi.fn()}
        outlineAwaiting
        onApproveOutline={handleApprove}
        onEditOutline={handleEdit}
      />
    );
    const save = screen.getByRole("button", { name: "Lưu sửa dàn ý" }) as HTMLButtonElement;
    const approve = screen.getByRole("button", { name: "Duyệt dàn ý" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(approve.disabled).toBe(false);

    fireEvent.change(screen.getByRole("textbox", { name: "Câu hỏi trung tâm" }), { target: { value: "Câu hỏi mới?" } });
    expect(save.disabled).toBe(false);
    expect(approve.disabled).toBe(true);

    fireEvent.click(save);
    await waitFor(() => expect(handleEdit).toHaveBeenCalledWith({ centralQuestion: "Câu hỏi mới?" }));
  });

  it("resets unsaved drafts to the server outline when a refetched outline arrives", () => {
    const panelProps = { onSwitchHook: vi.fn(), onRescore: vi.fn(), outlineAwaiting: true, onApproveOutline: vi.fn(), onEditOutline: vi.fn() };
    const { rerender } = render(<ScriptDraftPanel draft={mockDraft} {...panelProps} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Câu hỏi trung tâm" }), { target: { value: "Nháp chưa lưu" } });
    expect(screen.getByRole("button", { name: "Hoàn tác" })).toBeTruthy();

    const refetched = { ...mockDraft, outline: { ...mockDraft.outline!, centralQuestion: "Câu hỏi mới?" } };
    rerender(<ScriptDraftPanel draft={refetched} {...panelProps} />);
    expect((screen.getByRole("textbox", { name: "Câu hỏi trung tâm" }) as HTMLTextAreaElement).value).toBe("Câu hỏi mới?");
    expect((screen.getByRole("button", { name: "Lưu sửa dàn ý" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Duyệt dàn ý" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends only the beat whose concrete moment changed", async () => {
    const handleEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <ScriptDraftPanel
        draft={mockDraft}
        onSwitchHook={vi.fn()}
        onRescore={vi.fn()}
        outlineAwaiting
        onApproveOutline={vi.fn()}
        onEditOutline={handleEdit}
      />
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Khoảnh khắc nhịp 1" }), { target: { value: "Khoảnh khắc sửa" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu sửa dàn ý" }));
    await waitFor(() => expect(handleEdit).toHaveBeenCalledWith({ beats: [{ id: "b1", concreteMoment: "Khoảnh khắc sửa" }] }));
  });
});
