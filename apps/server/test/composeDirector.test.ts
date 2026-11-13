import { describe, expect, it } from "vitest";
import { checkVariety, getLangPack, parseNumbers, validateScenePlan, type KindSpan, type SceneWord, type TimelineScene } from "@vg/shared";
import { planProject } from "../src/compose/composeService.js";
import type { DirectorInput } from "../src/compose/director.js";
import {
  buildDirectorPrompt,
  createLlmDirector,
  createRuleDirector,
  directByRules,
  mergeLlmAnswer,
  PROMPT_MAX_TOKENS,
  ruleDirector,
} from "../src/compose/director/index.js";
import { spanSec } from "../src/compose/director/rules.js";
import type { FootageHit } from "../src/providers/footage/types.js";

const WORD_SEC = 0.28;

function speak(text: string): { words: SceneWord[]; durationSec: number } {
  let t = 0.1;
  const words = text.split(/\s+/).filter(Boolean).map((token, i): SceneWord => {
    const startSec = t;
    const endSec = t + WORD_SEC;
    const punct = /[,;:.!?…]$/u.test(token);
    t = endSec + (punct ? 0.24 : 0.04);
    return { i, text: token, startSec, endSec, sentenceEnd: /[.!?…]$/u.test(token), punct };
  });
  return { words, durationSec: Math.round((t + 0.2) * 30) / 30 };
}

function hit(id: string): FootageHit {
  return {
    provider: "pixabay",
    clipId: id,
    url: `https://video.example/${id}.mp4`,
    width: 1280,
    height: 720,
    durationSec: 12,
    author: "An",
    licenseName: "Pixabay License",
    pageUrl: `https://pixabay.com/videos/${id}`,
    previewImage: "",
    tags: ["city"],
    files: [],
  };
}

type Opts = { index?: number; count?: number; recipe?: string; aspect?: "16:9" | "9:16"; footage?: number; stills?: number; id?: string };

function input(text: string, opts: Opts = {}): DirectorInput {
  const spoken = speak(text);
  const index = opts.index ?? 1;
  return {
    scene: { sceneId: opts.id ?? `s${index}`, index, count: opts.count ?? 4, text, durationSec: spoken.durationSec },
    words: spoken.words,
    recipeId: opts.recipe ?? "explainer",
    aspect: opts.aspect ?? "16:9",
    stills: Array.from({ length: opts.stills ?? 1 }, (_, i) => ({ candidateId: `still-${i}`, path: `still-${i}.png` })),
    footage: Array.from({ length: opts.footage ?? 4 }, (_, i) => hit(`${opts.id ?? index}-${i}`)),
  };
}

function covers(spans: KindSpan[], count: number): boolean {
  let cursor = 0;
  for (const span of spans) {
    if (span.wordStart !== cursor || span.wordEnd <= span.wordStart) return false;
    cursor = span.wordEnd;
  }
  return cursor === count;
}

function textOf(scene: DirectorInput, span: KindSpan): string {
  return scene.words.slice(span.wordStart, span.wordEnd).map((word) => word.text).join(" ");
}

/** Directs one scene inside a longer video, so the 30 % graphic limit is judged on a real runtime. */
function direct(scene: DirectorInput, options: { language?: string; composeGraphics?: "off" | "static" | "animated" } = {}): KindSpan[] {
  const filler = [VIDEO[4]!, VIDEO[5]!, VIDEO[4]!].map((text, i) => input(text, { index: scene.scene.index + 1 + i, id: `filler-${i}`, aspect: scene.aspect, recipe: "explainer" }));
  return directByRules([scene, ...filler], options)[0]!;
}

function varietyScenes(inputs: DirectorInput[], spans: KindSpan[][]) {
  return inputs.map((scene, index) => ({ words: scene.words, spans: spans[index]!, hasFootage: scene.footage.length > 0, hasStill: scene.stills.length > 0 }));
}

const VIDEO = [
  "Bạn có biết, mỗi ngày chúng ta lãng phí hàng giờ đồng hồ cho điện thoại mà không hề nhận ra điều đó.",
  "Người Việt dùng mạng xã hội rất nhiều. Facebook chiếm 45%, YouTube 30%, TikTok 25%. Con số này vẫn đang thay đổi từng tháng.",
  "Thời gian dùng điện thoại năm 2019 là 3 giờ, năm 2024 là 6 giờ. Chúng ta đang mất dần sự tập trung vào công việc chính.",
  "Nhiều người nghĩ rằng họ kiểm soát được thói quen này mỗi ngày. Nhưng sự thật không phải vậy! Bộ não luôn muốn thêm một chút nữa.",
  "Hãy thử đặt điện thoại ở phòng khác trong một giờ đầu tiên của buổi sáng, rồi quan sát xem bạn làm được bao nhiêu việc.",
  "Sau một tuần, bạn sẽ thấy mình ngủ ngon hơn, đọc sách nhiều hơn và trò chuyện với gia đình nhiều hơn trước rất nhiều.",
];

function video(opts: Opts = {}): DirectorInput[] {
  return VIDEO.map((text, index) => input(text, { ...opts, index, count: VIDEO.length, id: `scene-${index}` }));
}

describe("ruleDirector rules", () => {
  it("R1 draws a pie when the shares add up to 100 %, with labels from the text", () => {
    const scene = input("Thị phần trình duyệt rất rõ. Chrome chiếm 62%, Safari 19%, Cốc Cốc 11% và Edge 8%. Phần còn lại không đáng kể.");
    const spans = direct(scene);
    const chart = spans.find((span) => span.kind === "chart");
    expect(chart?.reason).toBe("R1-numbers");
    expect(chart?.payload).toMatchObject({ kind: "chart", chart: "pie", labels: ["Chrome", "Safari", "Cốc Cốc", "Edge"], values: [62, 19, 11, 8], unit: "%" });
    expect(textOf(scene, chart!)).toContain("Chrome");
    expect(textOf(scene, chart!)).toContain("8%.");
    expect(covers(spans, scene.words.length)).toBe(true);
  });

  it("turns every graphic span into footage or still when compose graphics are off", () => {
    const scene = input("Thị phần trình duyệt rất rõ. Chrome chiếm 62%, Safari 19%, Cốc Cốc 11% và Edge 8%. Phần còn lại không đáng kể.");
    const spans = direct(scene, { composeGraphics: "off" });
    expect(spans.some((span) => span.kind === "chart" || span.kind === "kinetic_text")).toBe(false);
    expect(covers(spans, scene.words.length)).toBe(true);
    const converted = spans.filter((span) => span.reason.endsWith("+mode-off"));
    expect(converted.length).toBeGreaterThan(0);
    expect(converted.every((span) => span.payload == null && (span.kind === "footage" || span.kind === "still"))).toBe(true);
  });

  it("R1 draws a line for a series over years and a bar for the same unit", () => {
    const series = input("Hãy nhìn lại. Doanh thu năm 2020 là 100 tỷ, năm 2023 là 250 tỷ. Một bước tiến dài.");
    const line = direct(series).find((span) => span.kind === "chart");
    expect(line?.payload).toMatchObject({ chart: "line", title: "Doanh thu", labels: ["2020", "2023"], values: [100e9, 250e9] });

    const same = input("So sánh hai quý gần đây. Quý một đạt 120 tỷ, quý hai đạt 180 tỷ. Mức tăng rất tốt.");
    const bar = direct(same).find((span) => span.kind === "chart");
    expect(bar?.payload).toMatchObject({ chart: "bar", labels: ["Quý một", "quý hai"], values: [120e9, 180e9] });
  });

  it("R1 reads English numbers through the en pack", () => {
    const scene = input("Look at the trend. Sales were 2 million in 2020 and 5 million in 2023. That is real growth.");
    const chart = direct(scene, { language: "en" }).find((span) => span.kind === "chart");
    expect(chart?.payload).toMatchObject({ chart: "line", title: "Sales", labels: ["2020", "2023"], values: [2e6, 5e6] });
  });

  it("R1 is skipped when the labels are unclear or there is one number", () => {
    const unclear = input("Kết quả thay đổi nhanh. Tăng 40% rồi 60%. Không ai ngờ tới.");
    expect(direct(unclear).some((span) => span.kind === "chart")).toBe(false);
    const single = input("Chi phí giảm 12% chỉ sau một năm áp dụng cách làm mới này.");
    expect(direct(single).some((span) => span.kind === "chart")).toBe(false);
  });

  it("R2 opens the video with a kinetic hook of at most 2.5 s, 1.5 s for 9:16", () => {
    const wide = input(VIDEO[0]!, { index: 0 });
    const hook = direct(wide)[0]!;
    expect(hook).toMatchObject({ kind: "kinetic_text", wordStart: 0, reason: "R2-hook" });
    expect(wide.words[hook.wordEnd - 1]!.endSec).toBeLessThanOrEqual(2.5);
    expect(wide.words[hook.wordEnd - 1]!.endSec).toBeGreaterThanOrEqual(1.5);
    // The text is the whole first phrase; the shot holds it until 1.5 s instead of showing half of the next phrase.
    expect(hook.payload).toMatchObject({ kind: "kinetic_text", style: "bold", lines: ["Bạn có biết"] });

    const tall = input("Mỗi ngày chúng ta lãng phí hàng giờ đồng hồ cho điện thoại.", { index: 0, aspect: "9:16" });
    const first = direct(tall)[0]!;
    expect(first.reason).toBe("R2-hook");
    // A graphic shot cannot be shorter than 1.5 s, so the 9:16 opening is the first word end at or after 1.5 s.
    expect(tall.words[first.wordEnd - 1]!.endSec).toBeGreaterThanOrEqual(1.5);
    expect(tall.words[first.wordEnd - 2]!.endSec).toBeLessThan(1.5);
  });

  it("R2 also fires on later scenes of the short_hook recipe, and not on other recipes", () => {
    const later = input(VIDEO[4]!, { index: 2, recipe: "short_hook" });
    expect(direct(later)[0]!.reason).toBe("R2-hook");
    const plain = input(VIDEO[4]!, { index: 2 });
    expect(direct(plain)[0]!.kind).toBe("footage");
  });

  it("R3 puts a short heading before the picture for an ordinal start or a listicle scene", () => {
    const ordinal = input("Thứ nhất, ngủ đủ giấc. Giấc ngủ giúp cơ thể phục hồi và giữ cho đầu óc tỉnh táo suốt cả ngày dài.");
    const spans = direct(ordinal);
    expect(spans[0]).toMatchObject({ kind: "kinetic_text", reason: "R3-list" });
    expect(spans[0]!.payload).toMatchObject({ style: "stack", lines: ["Thứ nhất", "ngủ đủ giấc"], emphasis: [0, 1] });
    expect(["footage", "still"]).toContain(spans[1]!.kind);

    const digit = input("1. Uống đủ nước. Cơ thể cần nước để hoạt động tốt trong cả ngày làm việc.", { index: 2 });
    expect(direct(digit)[0]!.reason).toBe("R3-list");

    const listicle = input("Uống nước ấm, ngay khi thức dậy. Thói quen này giúp cơ thể tỉnh táo hơn rất nhiều.", { index: 2, recipe: "listicle" });
    expect(direct(listicle)[0]!.reason).toBe("R3-list");

    const english = input("First, sleep well. Your body repairs itself at night and your mind stays sharp all day long.", { index: 2 });
    expect(direct(english, { language: "en" })[0]!.reason).toBe("R3-list");
    expect(direct(english, { language: "th" })[0]!.reason).not.toBe("R3-list");
  });

  it("R4 uses footage when the scene has usable hits and R5 falls back to stills", () => {
    const withFootage = directByRules([input(VIDEO[4]!)])[0]!;
    expect(withFootage[0]).toMatchObject({ kind: "footage", reason: "R4-footage" });
    const without = directByRules([input(VIDEO[4]!, { footage: 0 })])[0]!;
    expect(without.every((span) => span.kind === "still" && span.reason.startsWith("R5-still"))).toBe(true);
    const silent: DirectorInput = { ...input("", { footage: 0 }), words: [] };
    expect(directByRules([silent])[0]).toEqual([{ kind: "still", wordStart: 0, wordEnd: 0, reason: "R5-still" }]);
  });

  it("R6 turns a short punchline into kinetic text, away from other graphics", () => {
    const scene = input(VIDEO[3]!);
    const spans = direct(scene);
    const punch = spans.find((span) => span.reason === "R6-emphasis");
    expect(punch?.kind).toBe("kinetic_text");
    expect(textOf(scene, punch!)).toBe("Nhưng sự thật không phải vậy!");
    expect(spanSec(scene, punch!.wordStart, punch!.wordEnd)).toBeLessThanOrEqual(3);

    const contrast = input("Many people think they are in control of this habit every single day. But the brain wants more. It never really stops asking for it.");
    const found = direct(contrast, { language: "en" }).find((span) => span.reason === "R6-emphasis");
    expect(textOf(contrast, found!)).toBe("But the brain wants more.");
    expect(found?.payload).toMatchObject({ style: "typewriter" });
    expect(direct(contrast, { language: "th" }).some((span) => span.reason === "R6-emphasis")).toBe(false);

    const long = input("Chúng ta thường nghĩ như vậy. Nhưng sự thật thì hoàn toàn khác xa so với những gì mọi người vẫn hay nghĩ! Hãy xem tiếp.");
    expect(direct(long).some((span) => span.reason === "R6-emphasis")).toBe(false);
  });
});

describe("ruleDirector variety", () => {
  const inputs = video();
  const spans = directByRules(inputs);
  const flat = spans.flat();
  const sec = (kinds: string[]) => inputs.reduce((sum, scene, index) => sum + spans[index]!
    .filter((span) => kinds.includes(span.kind))
    .reduce((inner, span) => inner + spanSec(scene, span.wordStart, span.wordEnd), 0), 0);
  const total = sec(["still", "footage", "kinetic_text", "chart"]);

  it("covers every word of every scene and uses all four kinds", () => {
    inputs.forEach((scene, index) => expect(covers(spans[index]!, scene.words.length)).toBe(true));
    expect(new Set(flat.map((span) => span.kind))).toEqual(new Set(["still", "footage", "kinetic_text", "chart"]));
    expect(checkVariety(varietyScenes(inputs, spans))).toEqual([]);
  });

  it("V1: never more than 2 spans of one kind in a row, across scene edges", () => {
    let run = 0;
    let previous = "";
    for (const span of flat) {
      run = span.kind === previous ? run + 1 : 1;
      previous = span.kind;
      expect(run).toBeLessThanOrEqual(2);
    }
  });

  it("V2: stills stay at or under 40 % of the runtime when footage exists", () => {
    expect(sec(["still"]) / total).toBeLessThanOrEqual(0.4);
    expect(sec(["still"])).toBeGreaterThan(0);
  });

  it("V3: graphic kinds together stay at or under 30 % of the runtime", () => {
    expect(sec(["kinetic_text", "chart", "map", "compare", "quote_full", "list_full"]) / total).toBeLessThanOrEqual(0.3);
    const heavy = VIDEO.slice(0, 4).map((text, index) => input(text, { index, count: 4, id: `h${index}`, recipe: "short_hook" }));
    const result = directByRules(heavy);
    expect(checkVariety(varietyScenes(heavy, result)).filter((item) => item.rule === "V3-graphic")).toEqual([]);
  });

  it("V4: no kinetic text repeats the spoken words for more than 3 s", () => {
    inputs.forEach((scene, index) => spans[index]!.filter((span) => span.kind === "kinetic_text").forEach((span) => {
      expect(spanSec(scene, span.wordStart, span.wordEnd)).toBeLessThanOrEqual(3);
    }));
  });

  it("gives the same output for the same input", async () => {
    expect(directByRules(video())).toEqual(spans);
    expect(await ruleDirector.directScenes(video())).toEqual(await createRuleDirector({ language: "vi" }).directScenes(video()));
  });

  it("keeps the first 9:16 shot short and stays inside the limits", () => {
    const tall = video({ aspect: "9:16" });
    const result = directByRules(tall);
    expect(tall[0]!.words[result[0]![0]!.wordEnd - 1]!.endSec).toBeLessThanOrEqual(2.1);
    expect(checkVariety(varietyScenes(tall, result))).toEqual([]);
  });
});

describe("createLlmDirector", () => {
  const inputs = video();
  const rule = directByRules(inputs);

  it("calls the LLM once and keeps the rule result when the answer is not JSON", async () => {
    const warnings: string[] = [];
    let calls = 0;
    const director = createLlmDirector(async () => { calls += 1; return "Xin lỗi, tôi không thể."; }, { onWarning: (message) => warnings.push(message) });
    expect(await director.directScenes(inputs)).toEqual(rule);
    expect(calls).toBe(1);
    expect(warnings).toHaveLength(1);
    const failing = createLlmDirector(async () => { throw new Error("hết quota"); }, { onWarning: (message) => warnings.push(message) });
    expect(await failing.directScenes(inputs)).toEqual(rule);
    expect(warnings[1]).toContain("hết quota");
  });

  it("applies a valid scene and falls back per scene for an invalid one", () => {
    const warnings: string[] = [];
    const last = inputs[5]!;
    const n = last.words.length;
    const answer = JSON.stringify([
      { sceneId: "scene-5", spans: [{ kind: "footage", words: [0, n - 5] }, { kind: "kinetic_text", words: [n - 5, n], payload: { lines: ["nhiều hơn trước", "rất nhiều"], emphasis: [3, 4], style: "bold" } }] },
      { sceneId: "scene-4", spans: [{ kind: "footage", words: [0, 5] }, { kind: "still", words: [7, inputs[4]!.words.length] }] },
      { sceneId: "nope", spans: [{ kind: "still", words: [0, 3] }] },
    ]);
    const merged = mergeLlmAnswer(inputs, rule, "```json\n" + answer + "\n```", { onWarning: (message) => warnings.push(message) });
    expect(merged[4]).toEqual(rule[4]);
    expect(merged[5]!.at(-1)).toMatchObject({ kind: "kinetic_text", reason: "llm", payload: { lines: ["nhiều hơn trước", "rất nhiều"] } });
    expect(warnings).toHaveLength(2);
    inputs.forEach((scene, index) => expect(covers(merged[index]!, scene.words.length)).toBe(true));
    expect(checkVariety(varietyScenes(inputs, merged))).toEqual([]);
  });

  it("drops invented chart numbers and refuses a chart without real ones", () => {
    const warnings: string[] = [];
    const scene = inputs[1]!;
    const n = scene.words.length;
    const chartAt = rule[1]!.find((span) => span.kind === "chart")!;
    const spansFor = (values: number[], labels: string[]) => [
      ...(chartAt.wordStart > 0 ? [{ kind: "footage", words: [0, chartAt.wordStart] }] : []),
      { kind: "chart", words: [chartAt.wordStart, chartAt.wordEnd], payload: { chart: "bar", title: "Mạng xã hội", labels, values, unit: "%" } },
      ...(chartAt.wordEnd < n ? [{ kind: "footage", words: [chartAt.wordEnd, n] }] : []),
    ];
    const partly = mergeLlmAnswer(inputs, rule, JSON.stringify([{ sceneId: "scene-1", spans: spansFor([45, 30, 25, 99], ["Facebook", "YouTube", "TikTok", "Zalo"]) }]), { onWarning: (message) => warnings.push(message) });
    expect(partly[1]!.find((span) => span.kind === "chart")?.payload).toMatchObject({ labels: ["Facebook", "YouTube", "TikTok"], values: [45, 30, 25] });
    expect(warnings.some((message) => message.includes("bỏ 1 số"))).toBe(true);

    const invented = mergeLlmAnswer(inputs, rule, JSON.stringify([{ sceneId: "scene-1", spans: spansFor([70, 80], ["A", "B"]) }]));
    expect(invented[1]!.some((span) => span.kind === "chart")).toBe(false);
    expect(covers(invented[1]!, n)).toBe(true);
  });

  it("replaces kinetic lines that use words the scene does not say", () => {
    const scene = inputs[4]!;
    const n = scene.words.length;
    const merged = mergeLlmAnswer(inputs, rule, JSON.stringify([{ sceneId: "scene-4", spans: [{ kind: "footage", words: [0, n - 5] }, { kind: "kinetic_text", words: [n - 5, n], payload: { lines: ["Mua ngay hôm nay"] } }] }]));
    const kinetic = merged[4]!.at(-1)!;
    expect(kinetic.kind).toBe("kinetic_text");
    expect(kinetic.payload?.kind === "kinetic_text" && kinetic.payload.lines.join(" ")).toBe("làm được bao nhiêu việc");
  });

  it("runs the variety pass again on the LLM plan", () => {
    const all = inputs.map((scene) => ({ sceneId: scene.scene.sceneId, spans: [{ kind: "kinetic_text", words: [0, 12] }, { kind: "footage", words: [12, scene.words.length] }] }));
    const merged = mergeLlmAnswer(inputs, rule, JSON.stringify(all));
    expect(merged).not.toEqual(rule);

    const tooLong = mergeLlmAnswer(inputs, rule, JSON.stringify([{ sceneId: "scene-4", spans: [{ kind: "kinetic_text", words: [0, inputs[4]!.words.length] }] }]));
    expect(tooLong).toEqual(rule);
    const found = checkVariety(varietyScenes(inputs, merged));
    expect(found.filter((item) => item.rule === "V3-graphic" || item.rule === "V4-subtitle")).toEqual([]);
    inputs.forEach((scene, index) => expect(covers(merged[index]!, scene.words.length)).toBe(true));
  });

  it("keeps a valid map and replaces one bad graphic span without dropping the scene", () => {
    const scene = input(`Bản đồ này chỉ ra Việt Nam nằm ở Đông Nam Á. ${"Hình minh hoạ tiếp tục chạy phía sau để đủ thời lượng. ".repeat(8)}`, { id: "scene-map", index: 0, count: 1, footage: 1 });
    const ruleOne = directByRules([scene]);
    let end = 2;
    while (end < scene.words.length && spanSec(scene, 0, end) < 3) end += 1;
    const n = scene.words.length;
    const bad = mergeLlmAnswer([scene], ruleOne, JSON.stringify([{
      sceneId: "scene-map",
      spans: [
        { kind: "compare", words: [0, end], payload: { left: { label: "Nhãn dài hơn mười sáu ký tự", text: "x" }, right: { label: "B", text: "y" } } },
        { kind: "footage", words: [end, n] },
      ],
    }]));
    expect(bad[0]![0]).toMatchObject({ kind: "kinetic_text", reason: "llm+bad-graphic" });
    expect(covers(bad[0]!, n)).toBe(true);

    const map = mergeLlmAnswer([scene], ruleOne, JSON.stringify([{
      sceneId: "scene-map",
      spans: [
        { kind: "map", words: [0, end], payload: { focus: "VN", zoom: "static", highlight: "outline" } },
        { kind: "footage", words: [end, n] },
      ],
    }]));
    expect(map[0]![0]).toMatchObject({ kind: "map", payload: { focus: "VN", zoom: "static", highlight: "outline" } });

    const off = mergeLlmAnswer([scene], ruleOne, JSON.stringify([{
      sceneId: "scene-map",
      spans: [
        { kind: "map", words: [0, end], payload: { focus: "VN" } },
        { kind: "footage", words: [end, n] },
      ],
    }]), { composeGraphics: "off" });
    expect(off[0]!.some((span) => span.kind === "map")).toBe(false);
    expect(off[0]!.some((span) => span.reason.includes("mode-off"))).toBe(true);
  });

  it("keeps the prompt under 2 000 tokens for 12 long scenes and names the language", () => {
    const long = Array.from({ length: 12 }, (_, index) => input(`${VIDEO[index % VIDEO.length]!} ${VIDEO[(index + 1) % VIDEO.length]!} ${VIDEO[(index + 2) % VIDEO.length]!}`, {
      index,
      count: 12,
      id: `0f8fad5b-d9cb-469f-a165-70867728950${index.toString(16)}`,
    }));
    const prompt = buildDirectorPrompt(long, directByRules(long), { language: "vi" });
    expect(Math.ceil(prompt.length / 4)).toBeLessThanOrEqual(PROMPT_MAX_TOKENS);
    expect(prompt).toContain("Video language: vi");
    expect(prompt.split("\n").filter((line) => line.startsWith("{\"sceneId\"")).length).toBe(12);
    expect(buildDirectorPrompt(long, directByRules(long), { language: "vi" })).toBe(prompt);
  });
});

describe("number parsing behind R1", () => {
  it("does not take the word after a clause mark as the unit", () => {
    const mentions = parseNumbers("Quý một đạt 120 tỷ, quý hai đạt 180 tỷ.".split(" "), getLangPack("vi"));
    expect(mentions.map((mention) => [mention.value, mention.unit])).toEqual([[120e9, "count"], [180e9, "count"]]);
  });

  it("falls back to digits only for an unknown language", () => {
    const scene = input("A 40%, B 60%. จบ แล้ว ครับ ทุก คน.", { index: 2 });
    const chart = direct(scene, { language: "th" }).find((span) => span.kind === "chart");
    expect(chart?.payload).toMatchObject({ chart: "pie", labels: ["A", "B"], values: [40, 60] });
  });
});

describe("ruleDirector in planProject", () => {
  it("gives a valid plan that meets the eval targets", async () => {
    const inputs = video();
    const scenes: TimelineScene[] = inputs.map((item, index) => {
      const frames = Math.round(item.scene.durationSec * 30);
      return {
        sceneId: item.scene.sceneId,
        order: index,
        label: item.scene.text,
        startSec: 0,
        endSec: frames / 30,
        durationSec: frames / 30,
        durationFrames: frames,
        voice: null,
        visuals: [{ kind: "IMAGE", candidateId: `still-${index}`, path: `still-${index}.png`, startSec: 0, endSec: frames / 30, motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } }, motionPreset: "static", licenseKind: "ROYALTY_FREE" }],
        fadeInSec: 0,
        fadeOutSec: 0,
      };
    });
    const plan = await planProject({
      timeline: { scenes, music: null },
      scenes: inputs.map((item) => ({ id: item.scene.sceneId, narration: item.scene.text, visualQueries: { primary: `city ${item.scene.sceneId}`, alternatives: [] } })),
      voiceTracks: inputs.map((item) => ({ sceneId: item.scene.sceneId, words: item.words.map((word) => ({ startSec: word.startSec - 0.1, endSec: word.endSec - 0.1, text: word.text })), timingSource: "provider" as const })),
      recipeId: "explainer",
      preset: "news",
      aspect: "16:9",
      director: ruleDirector,
      footageSearch: async (query) => [0, 1, 2, 3, 4, 5].map((i) => hit(`${query}-${i}`)),
    });
    plan.scenes.forEach((scene) => {
      expect(scene.warnings).toEqual([]);
      expect(validateScenePlan(scene, [])).toEqual([]);
    });
    expect(plan.stats.kindEntropyBits).toBeGreaterThanOrEqual(1.2);
    expect(plan.stats.maxSameKindRun).toBeLessThanOrEqual(2);
    expect(plan.stats.kindShare.still).toBeLessThanOrEqual(0.4);
    expect(plan.stats.shotsPerMin).toBeGreaterThanOrEqual(12);
    expect(plan.stats.shotsPerMin).toBeLessThanOrEqual(30);
  });
});

describe("ruleDirector new graphic kinds", () => {
  it("places a map, a compare, a quote and a list, and leaves a plain scene alone", () => {
    const map = input("Bản đồ Việt Nam cho thấy vị trí của đất nước trong khu vực này. Phần sau chỉ để câu đủ dài cho cảnh.", { id: "map", footage: 2 });
    const province = input("Tây Ninh có nhiều vườn điều và nhà máy đường. Câu này kéo dài thêm để cảnh đủ thời gian xem.", { id: "province", recipe: "news_recap", footage: 2 });
    const compare = input("Cà phê máy khác với cà phê phin ở độ đậm. Phần còn lại của cảnh nói về cách pha cho đủ dài.", { id: "compare", footage: 2 });
    const quote = input("An nói: “Uống nước đều mỗi ngày giúp cơ thể tỉnh táo hơn hẳn.” Phần còn lại của cảnh chỉ là hình minh hoạ cho lời vừa đọc và giữ câu trích dưới một nửa thời lượng.", { id: "quote", footage: 2 });
    const list = input("1. Ngủ đủ giấc. 2. Uống nước. 3. Đi bộ mỗi ngày. Ba việc này giữ sức khoẻ lâu dài hơn và phần còn lại chỉ để danh sách nằm dưới một nửa thời lượng của cảnh.", { id: "list", recipe: "listicle", footage: 2 });
    const plain = input("Hôm nay trời nắng và đường phố khá vắng người đi bộ. Câu này không có số, không so sánh và không trích dẫn.", { id: "plain", footage: 2 });

    expect(direct(map).find((span) => span.kind === "map")).toMatchObject({ reason: "R7-map", payload: { kind: "map", focus: "VN" } });
    expect(direct(province).find((span) => span.kind === "map")?.payload).toMatchObject({ kind: "map", focus: "VN-37" });
    const compared = direct(compare).find((span) => span.kind === "compare");
    expect(compared?.reason).toBe("R8-compare");
    expect(compared?.payload).toMatchObject({ kind: "compare", style: "versus" });
    const quoted = direct(quote).find((span) => span.kind === "quote_full");
    expect(quoted?.reason).toBe("R9-quote");
    expect(quoted?.payload).toMatchObject({ kind: "quote_full", speaker: "An" });
    const listed = direct(list);
    expect(listed.some((span) => span.kind === "list_full" && span.reason === "R10-list")).toBe(true);
    expect(listed.some((span) => span.reason === "R3-list")).toBe(false);
    expect(direct(plain).some((span) => span.kind === "map" || span.kind === "compare" || span.kind === "quote_full" || span.kind === "list_full")).toBe(false);
    for (const scene of [map, province, compare, quote, list, plain]) {
      expect(covers(direct(scene), scene.words.length)).toBe(true);
    }
  });

  it("turns those graphics off with the budget and splits two stills when footage is missing", () => {
    const map = input("Bản đồ Việt Nam cho thấy vị trí của đất nước trong khu vực này. Phần sau chỉ để câu đủ dài cho cảnh.", { footage: 2 });
    expect(direct(map, { composeGraphics: "off" }).some((span) => span.kind === "map")).toBe(false);
    const stills = input("Hôm nay trời nắng và đường phố khá vắng người đi bộ. Câu này không có số, không so sánh và không trích dẫn.", { footage: 0, stills: 2 });
    const spans = directByRules([stills])[0]!;
    expect(spans.filter((span) => span.kind === "still").length).toBeGreaterThanOrEqual(2);
    expect(covers(spans, stills.words.length)).toBe(true);
  });

  it("tells the model when to use the four new kinds", () => {
    const scene = input("Bản đồ Việt Nam cho thấy vị trí của đất nước.", { footage: 1 });
    const prompt = buildDirectorPrompt([scene], [[{ kind: "footage", wordStart: 0, wordEnd: scene.words.length, reason: "R4-footage" }]], { language: "vi" });
    expect(prompt).toContain("quote_full");
    expect(prompt).toContain("list_full");
    expect(prompt).toContain("2.5 to 7");
  });

  it("keeps locked shots when the plan is built again", async () => {
    const spoken = input("Sóng biển dâng lên lúc bình minh trên mặt nước xanh trong.", { id: "lock-1", index: 0, count: 1, footage: 1, stills: 1 });
    const frames = Math.round(spoken.scene.durationSec * 30);
    const scene: TimelineScene = {
      sceneId: "lock-1",
      order: 0,
      label: "Khoá",
      startSec: 0,
      endSec: frames / 30,
      durationSec: frames / 30,
      durationFrames: frames,
      voice: null,
      visuals: [{ kind: "IMAGE", candidateId: "still-0", path: "still-0.png", startSec: 0, endSec: frames / 30, motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } }, motionPreset: "static", licenseKind: "CC0" }],
      fadeInSec: 0,
      fadeOutSec: 0,
    };
    const common = {
      timeline: { scenes: [scene], music: null },
      scenes: [{ id: "lock-1", narration: spoken.scene.text }],
      voiceTracks: [{ sceneId: "lock-1", words: spoken.words.map((word) => ({ startSec: word.startSec, endSec: word.endSec, text: word.text })), timingSource: "provider" as const }],
      recipeId: "explainer",
      preset: "story" as const,
      aspect: "16:9" as const,
      rankFootage: false,
      footageSearch: async () => spoken.footage,
    };
    const first = await planProject({
      ...common,
      director: { id: "footage", directScenes: async (inputs) => inputs.map((item) => [{ kind: "footage" as const, wordStart: 0, wordEnd: item.words.length, reason: "locked-footage" }]) },
    });
    const locked = first.scenes[0]!.shots.map((shot) => ({ ...shot, locked: true as const }));
    const second = await planProject({
      ...common,
      director: { id: "still", directScenes: async (inputs) => inputs.map((item) => [{ kind: "still" as const, wordStart: 0, wordEnd: item.words.length, reason: "fresh-still" }]) },
      lockedShots: [{ sceneId: "lock-1", shots: locked }],
    });
    expect(second.scenes[0]!.shots.map((shot) => shot.id)).toEqual(locked.map((shot) => shot.id));
    expect(second.scenes[0]!.shots.every((shot) => shot.locked)).toBe(true);
    expect(validateScenePlan(second.scenes[0]!, spoken.words)).toEqual([]);
  });
});
