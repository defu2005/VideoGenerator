import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Field } from "./Field";
import { Modal } from "./Modal";
import { Table } from "./Table";
import { Tabs } from "./Tabs";

function TabsDemo() {
  const [value, setValue] = useState("one");
  return (
    <Tabs
      value={value}
      onChange={setValue}
      tabs={[{ id: "one", label: "Một" }, { id: "two", label: "Hai" }]}
    />
  );
}

describe("ui components", () => {
  it("renders button variants and a loading state that blocks a second submit", () => {
    render(
      <div>
        <Button variant="primary">Lưu</Button>
        <Button variant="secondary">Huỷ</Button>
        <Button variant="ghost">Xem</Button>
        <Button variant="danger">Xoá</Button>
        <Button loading>Đang lưu</Button>
      </div>,
    );
    expect(screen.getByRole("button", { name: "Lưu" })).toHaveClass("ui-button-primary");
    expect(screen.getByRole("button", { name: "Huỷ" })).toHaveClass("ui-button-secondary");
    expect(screen.getByRole("button", { name: "Xem" })).toHaveClass("ui-button-ghost");
    expect(screen.getByRole("button", { name: "Xoá" })).toHaveClass("ui-button-danger");
    const loading = screen.getByRole("button", { name: "Đang lưu" });
    expect(loading).toBeDisabled();
    expect(loading).toHaveAttribute("aria-busy", "true");
  });

  it("shows a field error on the control", () => {
    render(
      <Field label="Tên" error="Bắt buộc">
        {(props) => <input {...props} />}
      </Field>,
    );
    expect(screen.getByLabelText("Tên")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Bắt buộc");
  });

  it("renders an empty table row", () => {
    render(<Table rows={[]} columns={[{ key: "name", header: "Tên", cell: (row: { id: string }) => row.id }]} />);
    expect(screen.getByText("Chưa có dữ liệu")).toBeInTheDocument();
  });

  it("moves tabs with the arrow keys", () => {
    render(<TabsDemo />);
    const first = screen.getByRole("tab", { name: "Một" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Hai" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes a modal on Escape and focuses the first control", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Xác nhận" onClose={onClose}>
        <button type="button">Giữ</button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Giữ" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
