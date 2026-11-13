import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ResourceCard } from "./ResourceCard";

afterEach(() => vi.unstubAllGlobals());

describe("ResourceCard", () => {
  it("shows load and slots per class", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      enabled: true, workerCap: 8, overVi: ["RAM"],
      sample: { cpuPct: 41.2, ramPct: 90, diskFreeBytes: 120 * 1024 ** 3, gpuPct: null },
      classes: [{ class: "io", labelVi: "Tải và đăng (mạng, đĩa)", limit: 4, running: 3, waiting: 2 }],
    })));
    renderWithProviders(<ResourceCard />);
    expect(await screen.findByText("Tài nguyên")).toBeInTheDocument();
    expect(await screen.findByText(/CPU 41% · RAM 90%/)).toBeInTheDocument();
    expect(screen.getByText(/Tải và đăng \(mạng, đĩa\): 3\/4 đang chạy, 2 đang chờ/)).toBeInTheDocument();
    expect(screen.getByText(/Máy đang quá tải \(RAM\)/)).toBeInTheDocument();
  });

  it("renders nothing when the server has no governor data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    renderWithProviders(<ResourceCard />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText("Tài nguyên")).toBeNull();
  });
});
