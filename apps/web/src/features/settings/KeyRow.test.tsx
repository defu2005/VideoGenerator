import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SecretStatus } from "@vg/shared";
import { KeyRow, sourceBadge } from "./KeyRow";

const status = (patch: Partial<SecretStatus>): SecretStatus => ({
  id: "image.pexels.apiKey",
  configured: false,
  source: "none",
  hint: null,
  updatedAt: null,
  envNames: ["PEXELS_API_KEY"],
  ...patch,
});

describe("KeyRow", () => {
  it("saves a trimmed key and clears the write-only input", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KeyRow label="Pexels" status={status({})} onSave={onSave} />);
    const input = screen.getByLabelText("Pexels") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "  abc123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("abc123"));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("shows the source badge, hint and the remove button only for keys saved in the app", () => {
    const { rerender } = render(
      <KeyRow label="Pexels" status={status({ configured: true, source: "env", hint: "…c123" })} onSave={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Từ file .env")).toBeInTheDocument();
    expect(screen.getByText("…c123")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xoá" })).toBeNull();
    rerender(<KeyRow label="Pexels" status={status({ configured: true, source: "app", hint: "…c123" })} onSave={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Đã lưu trong app")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xoá" })).toBeInTheDocument();
  });

  it("warns when a saved key cannot be decrypted", () => {
    render(<KeyRow label="Pexels" status={status({ error: "UNREADABLE", source: "none" })} onSave={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("không giải mã được");
    expect(sourceBadge(status({ error: "UNREADABLE" })).label).toBe("Không đọc được");
  });

  it("shows the error message when the test fails", async () => {
    const onTest = vi.fn().mockRejectedValue(new Error("Sai key"));
    render(<KeyRow label="Pexels" status={status({ configured: true, source: "app" })} onSave={vi.fn()} onTest={onTest} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sai key");
  });
});
