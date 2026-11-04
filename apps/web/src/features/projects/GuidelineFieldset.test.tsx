import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { DEFAULT_GUIDELINE_DRAFT, GuidelineFieldset } from "./GuidelineFieldset";

const packs = {
  builtIn: [
    { id: "youtube", kind: "PLATFORM", name: "YouTube", description: "", reviewedAt: "2026-11-04", sourceUrls: [], rules: [{ id: "hook", text: "Vào thẳng chủ đề.", severity: "SHOULD", appliesTo: ["script"] }] },
    { id: "drama", kind: "CHANNEL", name: "Drama", description: "", reviewedAt: "2026-11-04", sourceUrls: [], rules: [{ id: "conflict", text: "Đặt xung đột sớm.", severity: "SHOULD", appliesTo: ["script"] }] },
    { id: "storytelling", kind: "CHANNEL", name: "Kể chuyện", description: "", reviewedAt: "2026-11-04", sourceUrls: [], rules: [{ id: "arc", text: "Có mạch truyện.", severity: "SHOULD", appliesTo: ["script"] }] },
  ],
  custom: [],
  disclaimer: "Đây là nhắc nhở tóm tắt, không thay thế chính sách chính thức.",
};

describe("GuidelineFieldset", () => {
  it("pre-checks suggested channel packs and shows their rules", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(packs)));
    const onChange = vi.fn();
    renderWithProviders(<GuidelineFieldset
      draft={DEFAULT_GUIDELINE_DRAFT}
      brief={{ platform: "youtube", style: "storytelling", tone: "dramatic", audience: "general" }}
      onChange={onChange}
    />);
    expect(await screen.findByRole("checkbox", { name: "Drama" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Kể chuyện" })).toBeChecked();
    fireEvent.click(screen.getByText(/Quy tắc của các gói đang chọn/));
    expect(screen.getByText("Đặt xung đột sớm.")).toBeInTheDocument();
    expect(screen.getByText(packs.disclaimer)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Mức áp dụng" }), { target: { value: "FILTER" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ strictness: "FILTER" }));
  });
});
