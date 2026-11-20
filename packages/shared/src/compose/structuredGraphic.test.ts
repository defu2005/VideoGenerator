import { describe, expect, it } from "vitest";
import { DiagramSourceSchema, TimelineSourceSchema, datedEvents, processLanguage, structuredGraphicTimes, timelineScale } from "./structuredGraphic.js";
import { applyGraphicTiming, fitGraphicPayload, isGraphicKind } from "./graphicKind.js";
import { directivesForRecipe } from "../style/genre.js";

const diagram = { kind: "diagram", nodes: [{ id: "a", label: "Nước" }, { id: "b", label: "Hơi nước" }], edges: [{ from: "a", to: "b" }], layout: "flow" };
describe("structured graphic contracts", () => {
  it("validates bounded nodes, unique IDs and references, rather than silently dropping edges", () => {
    expect(DiagramSourceSchema.safeParse(diagram).success).toBe(true);
    expect(DiagramSourceSchema.safeParse({ ...diagram, nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: "node" })) }).success).toBe(false);
    expect(DiagramSourceSchema.safeParse({ ...diagram, nodes: [diagram.nodes[0], diagram.nodes[0]] }).success).toBe(false);
    expect(fitGraphicPayload("diagram", { ...diagram, edges: [{ from: "a", to: "missing" }] })).toBeNull();
    expect(fitGraphicPayload("diagram", { ...diagram, edges: [{ from: "a", to: "a" }] })).toBeNull();
    expect(isGraphicKind("diagram")).toBe(true); expect(isGraphicKind("timeline")).toBe(true);
  });

  it("bounds events and aligns reveal times with whole spoken phrases", () => {
    const source = TimelineSourceSchema.parse({ kind: "timeline", events: ["1961", "1969", "1971"].map((date) => ({ date, label: "Sự kiện" })) });
    expect(TimelineSourceSchema.safeParse({ ...source, events: Array.from({ length: 9 }, () => source.events[0]) }).success).toBe(false);
    const words = [{ text: "nước", startSec: 2.1 }, { text: "hóa", startSec: 2.6 }, { text: "hơi", startSec: 3.2 }, { text: "nước", startSec: 3.5 }];
    expect(structuredGraphicTimes(["Nước", "Hơi nước"], words, 2, 5)).toEqual([0.1, 1.2]);
    expect(applyGraphicTiming(DiagramSourceSchema.parse(diagram), words, 2, 5, "vi").itemTimes).toEqual([0.1, 1.2]);
    expect(structuredGraphicTimes(["Nước", "Mây"], words, 2, 5)).toBeNull();
  });

  it("detects three dated statements without turning one range or bare statistics into events", () => {
    const words = (text: string) => text.split(/\s+/).map((text) => ({ text }));
    const found = datedEvents(words("Năm 1961 bay vào vũ trụ. Năm 1969 đặt chân lên Mặt Trăng. Năm 1971 có trạm không gian."));
    expect(found.map(({ date }) => date)).toEqual(["1961", "1969", "1971"]);
    expect(found[0]!.label).toBe("bay vào vũ trụ");
    expect(datedEvents(words("Năm 1961 bay vào vũ trụ, năm 1969 lên Mặt Trăng, năm 1971 có trạm không gian.")).map(({ date }) => date)).toEqual(["1961", "1969", "1971"]);
    expect(datedEvents(words("Từ 1961 đến 1969 đã có 1971 thử nghiệm."))).toEqual([]);
    expect(processLanguage("Nước nóng dẫn đến hơi nước.")).toBe(true);
    expect(processLanguage("The first step forms a cloud.")).toBe(true);
    expect(processLanguage("Một khu rừng xanh.")).toBe(false);
  });

  it("chooses a readable time scale in code and handles invalid or crowded dates", () => {
    const scale = timelineScale([{ date: "2000" }, { date: "2010" }, { date: "2020" }]);
    expect(scale.scale).toBe("time"); expect(scale.positions[1]).toBeCloseTo(0.5, 3);
    expect(timelineScale([{ date: "2000" }, { date: "2001" }, { date: "2099" }]).scale).toBe("sequence");
    expect(timelineScale([{ date: "31/02/2000" }, { date: "01/03/2000" }, { date: "02/03/2000" }]).scale).toBe("sequence");
  });

  it("enables the new kinds by genre data only", () => {
    for (const id of ["explainer", "how_to"]) expect(directivesForRecipe(id).disabledKinds).not.toContain("diagram");
    for (const id of ["history", "news_recap"]) expect(directivesForRecipe(id).disabledKinds).not.toContain("timeline");
    expect(directivesForRecipe("story").disabledKinds).toEqual(expect.arrayContaining(["diagram", "timeline"]));
  });
});
