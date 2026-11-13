import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pointInRing, type Shot } from "@vg/shared";
import { composeAssetRoot } from "../src/compose/hyperframes.js";
import { graphicVariables } from "../src/compose/render/graphicVars.js";
import { prepareMapGeo } from "../src/compose/render/mapGeo.js";

type Feature = {
  properties: { id: string; name: string; name_vi?: string; name_en?: string; level?: number; label?: [number, number]; parent?: string };
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
};

function readMap(name: string): { features: Feature[] } {
  return JSON.parse(readFileSync(join(composeAssetRoot(), "map", name), "utf8")) as { features: Feature[] };
}

function exterior(feature: Feature): [number, number][] {
  if (feature.geometry.type === "Polygon") return feature.geometry.coordinates[0] as [number, number][];
  const parts = feature.geometry.coordinates as [number, number][][][];
  return parts[0]?.[0] ?? [];
}

describe("committed Natural Earth maps", () => {
  const world = readMap("world.json");
  const vn = readMap("vn.json");

  it("keeps the world file under 150 KB and labels Vietnam near the middle of the country", () => {
    const bytes = Buffer.byteLength(JSON.stringify(world));
    expect(bytes).toBeLessThanOrEqual(150 * 1024);
    expect(bytes).toBeGreaterThan(80 * 1024);
    const country = world.features.find((feature) => feature.properties.id === "VN");
    expect(country?.properties).toMatchObject({ name: "Vietnam", name_vi: "Việt Nam", level: 0 });
    const label = country?.properties.label ?? [0, 0];
    expect(label[1]).toBeGreaterThan(12);
    expect(label[1]).toBeLessThan(19);
    expect(pointInRing(label[0], label[1], exterior(country!))).toBe(true);
    expect(world.features.every((feature) => feature.properties.id && feature.properties.name && feature.properties.name_en && feature.properties.level === 0 && feature.properties.label)).toBe(true);
    expect(vn.features).toHaveLength(60);
    expect(vn.features.some((feature) => feature.properties.id === "VN-39" || feature.properties.id === "VN-SG" && feature.properties.parent !== "VN")).toBe(false);
    expect(vn.features.find((feature) => feature.properties.id === "VN-SG")?.properties.name_vi).toBe("Thành phố Hồ Chí Minh");
  });

  it("sends a country view without provinces and a province view as parent plus province", () => {
    const country = prepareMapGeo({ focus: "VN" });
    expect(country.pin?.[1]).toBeGreaterThan(12);
    expect(country.pin?.[1]).toBeLessThan(19);
    expect(country.geo.features.some((feature) => feature.properties.id === "VN")).toBe(true);
    expect(country.geo.features.some((feature) => feature.properties.level === 1)).toBe(false);
    expect(country.geo.features.some((feature) => feature.properties.id === "US")).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(country.geo))).toBeLessThanOrEqual(150 * 1024);

    const city = prepareMapGeo({ focus: "VN-SG", from: "VN" });
    expect(city.geo.features.map((feature) => feature.properties.id).sort()).toEqual(["VN", "VN-SG"]);
    expect(city.pin?.[1]).toBeGreaterThan(10);
    expect(city.pin?.[1]).toBeLessThan(11.5);
  });

  it("puts the baked pin and the variant on the template variables", () => {
    const shot: Shot = {
      id: "map-1", kind: "map", startSec: 0, endSec: 4, reason: "test",
      source: { kind: "map", focus: "VN", zoom: "fly", highlight: "glow", sublabel: "Đông Nam Á" },
    };
    const vars = graphicVariables(shot, 4, { width: 1920, height: 1080 }, { language: "vi", projectId: "p" });
    expect(vars.zoom).toBe("fly");
    expect(vars.highlight).toBe("glow");
    expect(vars.sublabel).toBe("Đông Nam Á");
    const pin = vars.pin as [number, number];
    expect(pin[1]).toBeGreaterThan(12);
    expect(pin[1]).toBeLessThan(19);
    const features = (vars.geo as { features: Feature[] }).features;
    expect(features.every((feature) => (feature.properties.level ?? 0) === 0)).toBe(true);

    const quote: Shot = {
      id: "q", kind: "quote_full", startSec: 0, endSec: 5, reason: "test",
      source: { kind: "quote_full", quote: "Đầu tư vào tri thức luôn mang lại lợi nhuận cao nhất", speaker: "Benjamin Franklin", reveal: "ghost", emphasis: [3, 4] },
    };
    const quoted = graphicVariables(quote, 5, { width: 1920, height: 1080 }, {});
    expect(quoted.words).toHaveLength(12);
    expect(quoted.reveal).toBe("ghost");
  });
});
