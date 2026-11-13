import { describe, expect, it } from "vitest";
import { buildJoinCommands, buildUpdateCommands, isLoopbackControlUrl } from "../src/index.js";

describe("node commands", () => {
  const join = buildJoinCommands({ controlUrl: "http://192.168.1.5:3000/", token: "vgj_abc", image: "vg", version: "1.2.3" });
  it("builds a docker command that exits for updates and uses the control version", () => {
    expect(join.docker).toContain("VG_CONTROL_URL=http://192.168.1.5:3000 ");
    expect(join.docker).toContain("VG_JOIN_TOKEN=vgj_abc");
    expect(join.docker).toContain("VG_EXIT_FOR_UPDATE=1");
    expect(join.docker).toContain("--restart on-failure");
    expect(join.docker.trim().endsWith("vg:1.2.3")).toBe(true);
  });
  it("builds a source command with the same token", () => {
    expect(join.source).toContain("VG_JOIN_TOKEN=vgj_abc");
    expect(join.source).toContain("npm run build");
  });
  it("builds update commands", () => {
    const update = buildUpdateCommands({ image: "vg", version: "1.2.3" });
    expect(update.docker).toContain("compose.worker.yml pull");
    expect(update.docker).toContain("vg:1.2.3");
  });
  it("detects loopback control urls", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "http://a.localhost"]) expect(isLoopbackControlUrl(url)).toBe(true);
    for (const url of ["http://192.168.1.5:3000", "https://vg.example.com", "not a url"]) expect(isLoopbackControlUrl(url)).toBe(false);
  });
});
