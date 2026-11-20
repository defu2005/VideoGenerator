import { describe, expect, it, vi } from "vitest";
import { checkVariety, getLangPack, type KindSpan, type Shot } from "@vg/shared";
import type { DirectorInput } from "../src/compose/director.js";
import { createLlmDirector, createRuleDirector, directByRules, mergeLlmAnswer } from "../src/compose/director/index.js";
import { structuredPayloadIsSpoken, timelinePiece } from "../src/compose/director/kinds099.js";
import { graphicVariables } from "../src/compose/render/graphicVars.js";
import { speak } from "./helpers/genreFixtures.js";
import { STRUCTURED_099_FIXTURES } from "../src/compose/eval/structured099.js";

function input(text: string, recipeId = "explainer", index = 0): DirectorInput {
  const speech = speak(text);
  return { scene: { sceneId: `s${index}`, index, count: 3, text, durationSec: speech.durationSec }, words: speech.words, recipeId, aspect: "16:9", stills: [{ candidateId: "image", path: "image.png" }], footage: [] };
}
const process = STRUCTURED_099_FIXTURES[0]!.text;
const diagram = { kind: "diagram" as const, nodes: [{ id: "a", label: "Nước" }, { id: "b", label: "hơi nước" }, { id: "c", label: "mây" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }], layout: "flow" as const };
const dates = STRUCTURED_099_FIXTURES[1]!.text;
function inputs(first: DirectorInput) {
  return [first, input("Cảnh này chỉ là hình minh họa cho câu chuyện, không có một nội dung nào cần thay bằng đồ họa. ".repeat(2), "story", 1), input("Cảnh này nhắc lại bối cảnh và cho người xem đủ thời gian quan sát những chi tiết trước khi tiếp tục câu chuyện. ".repeat(2), "story", 2)];
}
describe("structured shot extraction", () => {
  it("uses literal dates for the code candidate, but not an unrelated genre", () => {
    expect(timelinePiece(input(dates, "history"))?.payload.kind).toBe("timeline");
    expect(timelinePiece(input(dates, "story"))).toBeNull();
    expect(timelinePiece(input("Năm 1961 bay vào vũ trụ. Năm 1969 lên Mặt Trăng.", "history"))).toBeNull();
    const history = input(`${dates} Phần còn lại kể về bối cảnh xã hội và những người đã dành nhiều năm nghiên cứu để biến các ý tưởng thành hiện thực. Họ tiếp tục làm việc và chia sẻ kết quả với nhiều thế hệ sau.`, "history", 1);
    const extended = [input("Khởi đầu câu chuyện, chúng ta cùng nhìn lại những chuyến đi đã thay đổi cách con người quan sát bầu trời.", "story", 0), history, inputs(history)[2]!];
    expect(directByRules(extended).flat()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "timeline" })]));
  });

  it("keeps diagrams out of the rule-only path and accepts a grounded model extraction", async () => {
    const scenes = inputs(input(process));
    expect(directByRules(scenes).flat().some((span) => span.kind === "diagram")).toBe(false);
    const llm = vi.fn(async () => JSON.stringify([{ sceneId: "s0", spans: [{ kind: "diagram", words: [0, scenes[0]!.words.length], payload: diagram }] }]));
    const result = await createLlmDirector(llm, { structuredOnly: true, allowTimeline: false }).directScenes(scenes);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(result[0]![0]).toMatchObject({ kind: "diagram", payload: diagram });
    expect(checkVariety(scenes.map((scene, index) => ({ words: scene.words, spans: result[index]!, hasFootage: false, hasStill: true })))).toEqual([]);
    await createRuleDirector({ composeGraphics: "off" }).directScenes(scenes);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("falls back to a list on invalid edges and refuses invented labels", () => {
    const scenes = inputs(input(process)), rule = directByRules(scenes);
    const answer = [{ sceneId: "s0", spans: [{ kind: "diagram", words: [0, scenes[0]!.words.length], payload: { ...diagram, edges: [{ from: "a", to: "missing" }] } }] }];
    const result = mergeLlmAnswer(scenes, rule, JSON.stringify(answer));
    expect(result[0]![0]!.kind).toBe("list_full");
    expect(structuredPayloadIsSpoken(scenes[0]!, { ...diagram, nodes: [{ id: "a", label: "Mặt Trời" }, ...diagram.nodes.slice(1)] })).toBe(false);
    const other = [{ sceneId: "s0", spans: [{ kind: "kinetic_text", words: [0, scenes[0]!.words.length], payload: {} }] }];
    expect(mergeLlmAnswer(scenes, rule, JSON.stringify(other), { structuredOnly: true })).toEqual(rule);
  });

  it("lets QUALITY refine a timeline and ignores model timings in favour of speech", async () => {
    const scenes = inputs(input(dates, "history"));
    const payload = timelinePiece(scenes[0]!)!.payload;
    const result = await createLlmDirector(async () => JSON.stringify([{ sceneId: "s0", spans: [{ kind: "timeline", words: [0, scenes[0]!.words.length], payload }] }])).directScenes(scenes);
    expect(result[0]![0]!.kind).toBe("timeline");
  });

  it("falls back when a node label is in the scene but is spoken outside the chosen shot span", () => {
    const scenes = inputs(input(`Quy trình gồm nước gặp nhiệt tạo thành hơi nước rồi ngưng tụ thành mây. Các bước tiếp theo được giải thích trong phần sau.`));
    const first = scenes[0]!, stop = first.words.findIndex((word) => word.text.startsWith("mây"));
    const answer = [{ sceneId: first.scene.sceneId, spans: [
      { kind: "diagram", words: [0, stop], payload: diagram },
      { kind: "still", words: [stop, first.words.length] },
    ] }];
    const result = mergeLlmAnswer(scenes, directByRules(scenes), JSON.stringify(answer));
    expect(result[0]!.some((span) => span.kind === "diagram")).toBe(false);
    expect(result[0]![0]!.kind).toBe("list_full");
  });

  it.each([{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }])("passes the token style and computed time scale at $width×$height", (size) => {
    const shot: Shot = { id: "timeline", kind: "timeline", startSec: 0, endSec: 7, reason: "test", source: { kind: "timeline", events: [{ date: "2000", label: "Khởi đầu" }, { date: "2010", label: "Mở rộng" }, { date: "2020", label: "Tiến lên" }], itemTimes: [0.2, 2, 4] } };
    const variables = graphicVariables(shot, 7, size, {});
    expect(variables.style).toBeDefined(); expect(variables.scale).toBe("time");
    const positions = (variables.events as Array<{ position: number }>).map((event) => event.position);
    expect(positions[0]).toBe(0); expect(positions[1]).toBeCloseTo(0.5, 3); expect(positions[2]).toBe(1);
    expect(variables.itemTimes).toEqual([0.2, 2, 4]);
  });
});
