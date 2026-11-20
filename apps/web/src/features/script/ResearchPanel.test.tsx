import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResearchPanel } from "./ResearchPanel";

// TASK-147b: agent sources (url, title, quote) on a fact must be visible in the research panel.
const research = {
  provider: "agent",
  model: "agent:research",
  cached: false,
  data: {
    summary: "Tóm tắt",
    keyFacts: [
      { fact: "Có nguồn", confidence: "high", sourceHint: "https://example.org/a", source: { url: "https://example.org/a", title: "Bài A", quote: "trích dẫn ngắn" } },
      { fact: "Không nguồn", confidence: "low", sourceHint: null },
    ],
    timeline: [],
    angles: [],
    outline: [],
    cautions: [],
  },
} as never;

describe("ResearchPanel sources (TASK-147b)", () => {
  it("shows the source title as a link and its quote for a sourced fact", () => {
    render(<ResearchPanel research={research} />);
    const link = screen.getByRole("link", { name: "Bài A" });
    expect(link.getAttribute("href")).toBe("https://example.org/a");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("trích dẫn ngắn")).toBeTruthy();
  });

  it("hides the raw URL hint when a source is present", () => {
    render(<ResearchPanel research={research} />);
    expect(screen.queryByText("https://example.org/a", { exact: false })).toBeNull();
  });

  it("does not link a non-http source URL", () => {
    const bad = JSON.parse(JSON.stringify(research));
    bad.data.keyFacts[0].source.url = "javascript:alert(1)";
    render(<ResearchPanel research={bad} />);
    expect(screen.queryByRole("link", { name: "Bài A" })).toBeNull();
    expect(screen.getByText("Bài A")).toBeTruthy();
  });

  it("shows no link for a fact without a source", () => {
    render(<ResearchPanel research={research} />);
    expect(screen.getByText("Không nguồn")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
