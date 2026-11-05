import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownView, parseMarkdown, rewriteGuideHref } from "./markdown";

const sample = [
  "# Tiêu đề {#tieu-de}",
  "",
  "Đoạn có **đậm**, *nghiêng*, `mã` và [Hồ sơ](ho-so.md#dinh-huong).",
  "",
  "<script>alert(1)</script>",
  "",
  "- Một",
  "- Hai",
  "",
  "1. Bước",
  "",
  "| Cột | Giá trị |",
  "| --- | --- |",
  "| A | B |",
  "",
  "```",
  "<b>không phải html</b>",
  "```",
  "",
  "![Sơ đồ](https://example.com/so-do.png)",
].join("\n");

describe("MarkdownView", () => {
  it("renders headings, lists, tables, code, links, images and emphasis", () => {
    render(<MarkdownView source={sample} />);
    expect(screen.getByRole("heading", { level: 1, name: "Tiêu đề" })).toHaveAttribute("id", "tieu-de");
    expect(screen.getByText("đậm").tagName).toBe("STRONG");
    expect(screen.getByText("nghiêng").tagName).toBe("EM");
    expect(screen.getByText("mã").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "Hồ sơ" })).toHaveAttribute("href", "/help/ho-so#dinh-huong");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sơ đồ" })).toHaveAttribute("src", "https://example.com/so-do.png");
    expect(screen.getByText("<b>không phải html</b>").closest("pre")).toBeTruthy();
  });

  it("escapes raw HTML instead of injecting it", () => {
    const { container } = render(<MarkdownView source={sample} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("keeps external links and parses the listed blocks", () => {
    expect(rewriteGuideHref("https://example.com/a")).toBe("https://example.com/a");
    const types = parseMarkdown(sample).map((block) => block.type);
    expect(types).toEqual(["heading", "paragraph", "paragraph", "list", "list", "table", "code", "paragraph"]);
  });
});
