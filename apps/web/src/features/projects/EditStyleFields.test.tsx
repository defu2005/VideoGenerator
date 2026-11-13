import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditStyleFields } from "./EditStyleFields";
import { renderWithProviders } from "../../test/testUtils";

describe("EditStyleFields", () => {
  it("saves the compose engine and the director", () => {
    const onChange = vi.fn();
    const first = renderWithProviders(<EditStyleFields edit={undefined} onChange={onChange} idPrefix="dự án" />);
    expect(screen.getByLabelText("dự án kiểu dựng")).toHaveValue("compose");
    fireEvent.change(screen.getByLabelText("dự án kiểu dựng"), { target: { value: "compose" } });
    expect(onChange).toHaveBeenCalledWith({ engine: "compose" });
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText("dự án kiểu dựng"), { target: { value: "legacy" } });
    expect(onChange).toHaveBeenCalledWith({ engine: "legacy" });
    first.unmount();
    onChange.mockClear();
    renderWithProviders(<EditStyleFields edit={{ engine: "compose" }} onChange={onChange} idPrefix="dự án" />);
    fireEvent.change(screen.getByLabelText("dự án đạo diễn"), { target: { value: "quality" } });
    expect(onChange).toHaveBeenCalledWith({ engine: "compose", directorMode: "quality" });
  });
});
