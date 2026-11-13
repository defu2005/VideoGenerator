import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { MapGeoSchema, parseBlackdetect, stylePackFromChoices, type AspectRatio, type ComposeStats, type EditPresetId, type Shot, type TimelineScene } from "@vg/shared";
import { beatGridForMusic } from "../beatsFile.js";
import { planProject, renderSceneClip } from "../composeService.js";
import { baselineDirector, type Director } from "../director.js";
import { createLlmDirector, createRuleDirector } from "../director/index.js";
import { composeAssetRoot, renderComposeTemplate } from "../hyperframes.js";
import { graphicVariables } from "../render/graphicVars.js";
import { renderShot as renderStill } from "../render/still.js";
import { resolveFfmpegPath, resolveFfprobePath } from "../../media/ffmpeg.js";
import type { FootageHit } from "../../providers/footage/types.js";

type Probe = { frames: number; freezes: number; blacks: number; renderSec: number; videoSec: number };

export type EvalMode = "legacy" | "baseline" | "rule" | "rule+llm(mock)" | "compose";
/** `footage`: footage shots in the plan, and how many of them show a clip the fixture marks as off-topic. */
export type EvalRow = { project: string; mode: EvalMode; scenes: number; stats: ComposeStats | null; footage?: { shots: number; offTopic: number } } & Probe;

/**
 * What the footage search returns for one scene: English queries as the script stage writes them, and
 * Pixabay-style clips (3–4 tags) in the provider's order. `on` is a person's call: does this clip fit the scene?
 */
type EvalVisual = { q: string; alt: string; clips: [tags: string, on: boolean][] };

const PROJECTS: {
  id: string;
  aspect: AspectRatio;
  preset: EditPresetId;
  recipeId: string;
  lines: string[];
  visuals: EvalVisual[];
}[] = [
  {
    id: "explainer",
    aspect: "16:9",
    preset: "news",
    recipeId: "explainer",
    lines: [
      "Bạn có biết, mỗi ngày chúng ta lãng phí hàng giờ cho điện thoại mà không hề nhận ra.",
      "Người Việt dùng mạng xã hội rất nhiều. Facebook chiếm 45%, YouTube 30%, TikTok 25%. Con số này thay đổi từng tháng.",
      "Thời gian dùng điện thoại năm 2019 là 3 giờ, năm 2024 là 6 giờ. Chúng ta đang mất dần sự tập trung.",
      "Nhiều người nghĩ rằng họ kiểm soát được thói quen này mỗi ngày. Nhưng sự thật không phải vậy! Bộ não luôn muốn thêm một chút nữa.",
    ],
    visuals: [
      { q: "person scrolling smartphone", alt: "hands holding phone", clips: [["smartphone, hands, scrolling", true], ["sunset, beach, sky", false], ["woman, phone, sofa, texting", true], ["person, hiking, mountain", false], ["mobile, phone, social media", true], ["man, smartphone, street, night", true]] },
      { q: "social media apps phone screen", alt: "facebook app icon", clips: [["screen, cinema, movie, audience", false], ["social media, apps, phone, icons", true], ["facebook, app, smartphone, logo", true], ["media, newspaper, press, print", false]] },
      { q: "distracted student phone desk", alt: "clock time passing", clips: [["student, phone, distracted, desk", true], ["desk, lamp, interior, design", false], ["clock, time, hands, ticking", true], ["student, graduation, ceremony", false]] },
      { q: "brain neurons activity", alt: "person thinking window", clips: [["abstract, particles, lights, loop", false], ["brain, neurons, animation, science", true], ["man, thinking, window, rain", true], ["window, curtains, wind", false]] },
    ],
  },
  {
    id: "listicle",
    aspect: "9:16",
    preset: "energetic",
    recipeId: "listicle",
    lines: [
      "Ba thói quen buổi sáng giúp bạn khỏe hơn, chỉ mất mười phút mỗi ngày.",
      "Thứ nhất, uống nước ấm. Một cốc nước ngay khi thức dậy giúp cơ thể tỉnh táo.",
      "Thứ hai, vận động nhẹ. Chỉ cần năm phút vươn vai là đủ để máu lưu thông tốt hơn.",
      "Thứ ba, ăn sáng đủ chất. Đừng bỏ bữa sáng, vì cơ thể cần năng lượng để bắt đầu ngày mới.",
      "Hãy thử ngay ngày mai. Bạn sẽ thấy khác biệt!",
    ],
    visuals: [
      { q: "morning sunrise bedroom window", alt: "woman waking up stretching", clips: [["sunrise, morning, window, bedroom", true], ["sunrise, mountain, timelapse, clouds", false], ["woman, waking, bed, stretching", true], ["bedroom, furniture, showroom", false]] },
      { q: "glass of water", alt: "woman drinking water morning", clips: [["waterfall, water, river, nature", false], ["water, glass, pouring, drink", true], ["woman, drinking, water, kitchen", true], ["glass, window, skyscraper, reflection", false]] },
      { q: "woman stretching yoga mat", alt: "morning exercise home", clips: [["yoga, woman, stretching, mat", true], ["gym, weights, bodybuilder", false], ["exercise, home, fitness, morning", true], ["mat, bamboo, texture", false]] },
      // No clip fits this scene: it must stay on stills.
      { q: "healthy breakfast table", alt: "eating oatmeal fruit bowl", clips: [["table, meeting, office, business", false], ["fruit, market, stall, street", false], ["bowl, pottery, hands, clay", false]] },
      { q: "happy woman smiling sunrise", alt: "person jumping joy outdoors", clips: [["sunrise, sea, horizon", false], ["woman, smiling, happy, portrait", true], ["man, jumping, joy, beach", true]] },
    ],
  },
  {
    id: "story",
    aspect: "16:9",
    preset: "story",
    recipeId: "story",
    lines: [
      "Ngày ấy, anh rời làng lên thành phố với một chiếc ba lô cũ và rất nhiều hy vọng.",
      "Năm đầu tiên, anh làm đủ mọi việc để sống. Có những đêm anh chỉ ngủ được ba tiếng.",
      "Mọi người khuyên anh nên quay về quê. Nhưng anh không bỏ cuộc! Anh tin rằng mình sẽ làm được.",
      "Mười năm sau, họ gặp lại anh trong một quán cà phê nhỏ, do chính anh làm chủ.",
    ],
    visuals: [
      { q: "young man backpack leaving village", alt: "bus countryside road", clips: [["man, backpack, walking, road", true], ["backpack, school, children, classroom", false], ["village, countryside, rice field", true], ["bus, road, countryside, travel", true]] },
      { q: "tired worker night shift", alt: "man sleeping desk", clips: [["night, city, lights, skyline", false], ["worker, night, factory, shift", true], ["man, sleeping, desk, tired", true], ["construction, worker, crane, sunny", false]] },
      { q: "determined man walking city street", alt: "person climbing stairs", clips: [["man, walking, street, city", true], ["street, food, market, vendor", false], ["stairs, climbing, person, steps", true], ["city, aerial, skyline, drone", false]] },
      { q: "small coffee shop owner smiling", alt: "barista making coffee", clips: [["shop, clothes, mall, shopping", false], ["coffee, barista, cafe, espresso", true], ["cafe, owner, smiling, apron", true]] },
    ],
  },
];

/** One word every 0.32 s, with a longer pause after a clause mark: close to a real TTS track. */
function speak(text: string): { words: { startSec: number; endSec: number; text: string }[]; durationSec: number } {
  let t = 0;
  const words = text.split(/\s+/).filter(Boolean).map((token) => {
    const startSec = t;
    const endSec = t + 0.28;
    t = endSec + (/[,;:.!?…]$/u.test(token) ? 0.24 : 0.04);
    return { startSec: Math.round(startSec * 1000) / 1000, endSec: Math.round(endSec * 1000) / 1000, text: token };
  });
  return { words, durationSec: Math.ceil((t + 0.6) * 30) / 30 };
}

/**
 * Stands in for the LLM in the `rule+llm(mock)` column. It reads the scene lines of the prompt and
 * turns the last words of the last scene into a closing kinetic text, so the merge path is measured too.
 */
export function mockDirectorLlm(prompt: string): Promise<string> {
  const scenes = prompt.split("\n").filter((line) => line.startsWith("{\"sceneId\"")).map((line) => JSON.parse(line) as { sceneId: string; n: number; rule: [string, number, number][] });
  const last = scenes.at(-1);
  if (!last || last.n < 12) return Promise.resolve("[]");
  const kinds: Record<string, string> = { k: "kinetic_text", c: "chart", f: "footage", s: "still" };
  const from = last.n - 6;
  const spans = last.rule
    .filter(([code, start]) => start < from && code !== "c")
    .map(([code, start, end]) => ({ kind: kinds[code] ?? "still", words: [start, Math.min(end, from)] }));
  if (spans.length === 0 || spans.at(-1)!.words[1] !== from) return Promise.resolve("[]");
  spans.push({ kind: "kinetic_text", words: [from, last.n] });
  return Promise.resolve(JSON.stringify([{ sceneId: last.sceneId, spans }]));
}

/** The first three rows take clips in the provider's order (as 067a did). `compose` is the final setup: rules plus ranked footage. */
const COMPOSE_MODES: { mode: EvalMode; director: Director; rank: boolean }[] = [
  { mode: "baseline", director: baselineDirector, rank: false },
  { mode: "rule", director: createRuleDirector({ language: "vi" }), rank: false },
  { mode: "rule+llm(mock)", director: createLlmDirector(mockDirectorLlm, { language: "vi" }), rank: false },
  { mode: "compose", director: createRuleDirector({ language: "vi" }), rank: true },
];
const CLIP_SECONDS = [12, 7, 20, 9, 15, 6];
const CLIP_AUTHORS = ["An", "Binh", "Chi"];
/** Length of the one real file behind every eval clip; it covers the longest `CLIP_SECONDS`. */
const EVAL_FOOTAGE_SEC = 24;

function evalHits(project: (typeof PROJECTS)[number], sceneIndex: number, localPath: string): { hits: FootageHit[]; off: Set<string> } {
  const off = new Set<string>();
  const hits = project.visuals[sceneIndex]!.clips.map(([tags, on], index): FootageHit => {
    const clipId = `${project.id}-${sceneIndex}-${index}`;
    if (!on) off.add(clipId);
    // One clip in three is landscape, also in the 9:16 project: portrait footage is scarce on Pixabay.
    const portrait = project.aspect === "9:16" && index % 3 !== 2;
    return {
      provider: "pixabay",
      clipId,
      url: "https://video.example/local.mp4",
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
      durationSec: CLIP_SECONDS[index % CLIP_SECONDS.length]!,
      author: CLIP_AUTHORS[(sceneIndex + index) % CLIP_AUTHORS.length]!,
      licenseName: "Pixabay Content License",
      pageUrl: `https://pixabay.com/videos/id-${sceneIndex}${index}/`,
      previewImage: "",
      tags: tags.split(",").map((tag) => tag.trim()),
      files: [],
      localPath,
    };
  });
  return { hits, off };
}

/** Plans one eval project. No files are read, so tests can check the plan targets without rendering. */
export async function planEval(
  projectId: string,
  mode: Exclude<EvalMode, "legacy">,
  files: { dir: string; footage: string; beats: Awaited<ReturnType<typeof beatGridForMusic>> } = { dir: "", footage: "", beats: null },
  director?: Director,
) {
  const project = PROJECTS.find((item) => item.id === projectId);
  const setup = COMPOSE_MODES.find((item) => item.mode === mode);
  if (!project || !setup) throw new Error(`Không có bài đo ${projectId}/${mode}`);
  let cursor = 0;
  const scenes = project.lines.map((line, index) => {
    const made = makeScene(files.dir, project.id, index, line, cursor);
    cursor = made.scene.endSec;
    return made;
  });
  const off = new Set<string>();
  const byQuery = new Map<string, FootageHit[]>();
  project.visuals.forEach((visual, index) => {
    const made = evalHits(project, index, files.footage);
    for (const id of made.off) off.add(id);
    byQuery.set(visual.q, made.hits);
    byQuery.set(visual.alt, [...made.hits].reverse());
  });
  const plan = await planProject({
    timeline: { scenes: scenes.map((item) => item.scene), music: null },
    scenes: scenes.map((item, index) => ({ id: item.id, narration: item.text, visualQueries: { primary: project.visuals[index]!.q, alternatives: [project.visuals[index]!.alt] } })),
    voiceTracks: scenes.map((item) => ({ sceneId: item.id, words: item.words, timingSource: "provider" as const })),
    recipeId: project.recipeId,
    preset: project.preset,
    aspect: project.aspect,
    beats: files.beats,
    director: director ?? setup.director,
    footageSearch: async (query) => byQuery.get(query) ?? [],
    rankFootage: setup.rank,
    targetShortSide: 1080,
  });
  const used = plan.scenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.source.kind === "footage" ? [shot.source.clipId] : []));
  return { project, scenes, plan, footage: { shots: used.length, offTopic: used.filter((id) => off.has(id)).length } };
}

export async function runComposeEval(): Promise<{ rows: EvalRow[]; hyperframes: string | null; markdown: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vg-eval-"));
  try {
    const footage = join(dir, "footage.mp4");
    await ffmpeg(["-y", "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=30:duration=${EVAL_FOOTAGE_SEC}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", footage]);
    const music = join(dir, "clicks.wav");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=8", "-ar", "11025", music]);
    const beats = await beatGridForMusic(dir, music).catch(() => null);
    const rows: EvalRow[] = [];
    for (const project of PROJECTS) {
      const target = project.aspect === "9:16" ? { width: 90, height: 160, fps: 30 } : { width: 160, height: 90, fps: 30 };
      let cursor = 0;
      const scenes = project.lines.map((line, index) => {
        const made = makeScene(dir, project.id, index, line, cursor);
        cursor = made.scene.endSec;
        return made;
      });
      for (const scene of scenes) await ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=${scene.color}:s=${target.width}x${target.height}:d=0.1`, "-frames:v", "1", scene.still]);
      rows.push(await renderLegacy(dir, project.id, scenes, target));
      for (const item of COMPOSE_MODES) rows.push(await renderCompose(dir, project.id, target, footage, beats, item.mode as Exclude<EvalMode, "legacy">));
    }
    const hyperframes = await probeTemplate(dir);
    const markdown = table(rows, hyperframes);
    return { rows, hyperframes, markdown };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeScene(dir: string, project: string, index: number, text: string, startSec = 0) {
  const spoken = speak(text);
  const frames = Math.round(spoken.durationSec * 30);
  const seconds = frames / 30;
  const id = `${project}-${index}`;
  const scene: TimelineScene = {
    sceneId: id,
    order: index,
    label: text,
    startSec,
    endSec: startSec + seconds,
    durationSec: seconds,
    durationFrames: frames,
    voice: null,
    visuals: [{
      kind: "IMAGE",
      candidateId: id,
      path: join(dir, `${id}.png`),
      startSec: 0,
      endSec: seconds,
      motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.08, x: 0.5, y: 0.5 } },
      licenseKind: "ROYALTY_FREE",
    }],
    fadeInSec: 0,
    fadeOutSec: 0,
  };
  return { id, text, words: spoken.words, still: join(dir, `${id}.png`), color: ["0x1D4E89", "0xC44536", "0x2E7D32", "0xF4A261", "0x6A4C93"][index] ?? "0x1D4E89", scene };
}

async function renderLegacy(dir: string, project: string, scenes: ReturnType<typeof makeScene>[], target: { width: number; height: number; fps: number }): Promise<EvalRow> {
  const started = Date.now();
  const clips: string[] = [];
  for (const item of scenes) {
    const out = join(dir, `${item.id}-legacy.mp4`);
    await renderStill({
      id: item.id,
      kind: "still",
      startSec: 0,
      endSec: item.scene.durationSec,
      reason: "legacy",
      source: { kind: "still", candidateId: item.id, path: item.still, motion: "push_in" },
    }, target, { dataDir: dir, outDir: join(dir, "legacy"), resolvePath: (path) => path });
    const { copyFile } = await import("node:fs/promises");
    const produced = join(dir, "legacy", `${item.id}.mp4`);
    await copyFile(produced, out);
    clips.push(out);
  }
  const probe = await probeMany(clips, (Date.now() - started) / 1000);
  return { project, mode: "legacy", scenes: scenes.length, stats: null, ...probe };
}

async function renderCompose(
  dir: string,
  projectId: string,
  target: { width: number; height: number; fps: number },
  footagePath: string,
  beats: Awaited<ReturnType<typeof beatGridForMusic>>,
  mode: Exclude<EvalMode, "legacy">,
): Promise<EvalRow> {
  const started = Date.now();
  const { scenes, plan, footage } = await planEval(projectId, mode, { dir, footage: footagePath, beats });
  const clips: string[] = [];
  for (const scene of plan.scenes) {
    const tag = mode.replace(/[^a-z]/g, "");
    const out = join(dir, `${scene.sceneId}-${tag}.mp4`);
    // Each mode has its own data dir: a shared scene cache would hide the render time of the later modes.
    await renderSceneClip(plan, scene.sceneId, target, { dataDir: join(dir, `data-${tag}`), outDir: join(dir, `compose-${tag}`), resolvePath: (path) => path }, out);
    clips.push(out);
  }
  const probe = await probeMany(clips, (Date.now() - started) / 1000);
  return { project: projectId, mode, scenes: scenes.length, stats: plan.stats, footage, ...probe };
}

async function probeTemplate(dir: string): Promise<string | null> {
  const rendered = await renderComposeTemplate({
    dataDir: dir,
    templateId: "kinetic_text",
    variables: { lines: ["Tăng 40%"], emphasis: [1], style: "bold", brandColor: "#0F172A", accentColor: "#F5C518" },
    width: 160,
    height: 90,
    fps: 30,
    durationSec: 2,
  });
  return rendered.warning ?? null;
}

async function probeMany(files: string[], renderSec: number): Promise<Probe> {
  let frames = 0;
  let freezes = 0;
  let blacks = 0;
  let videoSec = 0;
  for (const file of files) {
    const probed = await probeFile(file);
    frames += probed.frames;
    freezes += probed.freezes;
    blacks += probed.blacks;
    videoSec += probed.videoSec;
  }
  return { frames, freezes, blacks, renderSec, videoSec };
}

async function probeFile(file: string): Promise<{ frames: number; freezes: number; blacks: number; videoSec: number }> {
  const probed = await tool(resolveFfprobePath(), ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]);
  const frames = Number(probed.stdout.trim()) || 0;
  const freezeLog = await ffmpeg(["-i", file, "-vf", "freezedetect=n=0.003:d=1.5", "-f", "null", "-"], true);
  const blackLog = await ffmpeg(["-i", file, "-vf", "blackdetect=d=0.2:pix_th=0.10", "-f", "null", "-"], true);
  return {
    frames,
    freezes: (freezeLog.match(/freeze_start/g) ?? []).length,
    blacks: parseBlackdetect(blackLog).length,
    videoSec: frames / 30,
  };
}

function table(rows: EvalRow[], hyperframes: string | null): string {
  const header = "| Dự án | Chế độ | Cảnh | Khung | Đứng hình | Đen | Giây render / phút | Cảnh quay / phút | Entropy (bit) | Cụm cùng kiểu dài nhất | Ảnh tĩnh | Cắt đúng nhịp | Footage lệch chủ đề |";
  const line = "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
  const pct = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);
  const body = rows.map((row) => {
    const perMin = row.videoSec > 0 ? (row.renderSec / (row.videoSec / 60)).toFixed(1) : "0";
    const stats = row.stats
      ? `${row.stats.shotsPerMin.toFixed(1)} | ${row.stats.kindEntropyBits.toFixed(2)} | ${row.stats.maxSameKindRun} | ${pct(row.stats.kindShare.still)} | ${pct(row.stats.beatCutPct)}`
      : "– | – | – | – | –";
    const offTopic = row.footage ? `${row.footage.offTopic}/${row.footage.shots}` : "–";
    return `| ${row.project} | ${row.mode} | ${row.scenes} | ${row.frames} | ${row.freezes} | ${row.blacks} | ${perMin} | ${stats} | ${offTopic} |`;
  });
  const note = hyperframes
    ? `\nHyperFrames không dựng được mẫu toàn màn. 20 dòng stderr cuối:\n\n\`\`\`\n${hyperframes.split(/\r?\n/).slice(-20).join("\n")}\n\`\`\`\n`
    : "\nHyperFrames dựng được mẫu kinetic_text trong bài đo này.\n";
  const targets = "\nMục tiêu (TASK-067b): entropy ≥ 1,2 bit; cụm cùng kiểu ≤ 2; ảnh tĩnh ≤ 40% khi có footage; 12–30 cảnh quay/phút (16:9) hoặc 18–40 (9:16). Dòng `rule+llm(mock)` dùng LLM giả trong `runEval.ts`, không gọi LLM thật.\n\nDòng `compose` là cấu hình cuối: đạo diễn luật cộng footage xếp theo nghĩa của cảnh (`rankFootage`, ngưỡng 0,45). Ba dòng trước lấy clip theo thứ tự nguồn trả về. Cột \"Footage lệch chủ đề\" đếm số cảnh quay footage dùng clip mà bài đo đánh dấu là không hợp cảnh, trên tổng số cảnh quay footage. Clip trong bài đo có tag kiểu Pixabay (3–4 tag), không gọi mạng.\n";
  return `# Đo compose\n\n${header}\n${line}\n${body.join("\n")}\n${note}${targets}`;
}

function ffmpeg(args: string[], keepLog = false): Promise<string> {
  return tool(resolveFfmpegPath(), ["-hide_banner", "-nostdin", ...(keepLog ? [] : ["-loglevel", "error"]), ...args]).then((result) => result.stderr);
}

function tool(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error((stderr || stdout).trim().split(/\r?\n/).slice(-20).join("\n") || `${command} thoát ${code}`));
    });
  });
}

const KEEP_FROM = "## Đo trực tiếp";

const GRAPHICS_PREDICTED: Record<string, Record<"off" | "static" | "animated", number>> = {
  explainer: { off: 33.4, static: 36.3, animated: 105.8 },
  listicle: { off: 35.4, static: 40.3, animated: 115.3 },
  story: { off: 31.1, static: 33.8, animated: 71.3 },
};

/** 1080×1920, cold cache. Appends a section; it does not rewrite the historical table. */
export async function appendGraphicsModeEval(docPath: string): Promise<{ rows: { project: string; mode: string; composeGraphics: "off" | "static" | "animated"; perMin: number; predicted: number }[] }> {
  const dir = await mkdtemp(join(tmpdir(), "vg-gfx-"));
  const rows: { project: string; mode: string; composeGraphics: "off" | "static" | "animated"; perMin: number; predicted: number }[] = [];
  try {
    const footage = join(dir, "footage.mp4");
    await ffmpeg(["-y", "-f", "lavfi", "-i", `testsrc2=size=1080x1920:rate=30:duration=${EVAL_FOOTAGE_SEC}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", footage]);
    const target = { width: 1080, height: 1920, fps: 30 };
    const modes = [
      { budget: "ECO", composeGraphics: "off" as const },
      { budget: "BALANCED", composeGraphics: "static" as const },
      { budget: "QUALITY", composeGraphics: "animated" as const },
    ];
    for (const project of PROJECTS) {
      let cursor = 0;
      const scenes = project.lines.map((line, index) => {
        const made = makeScene(dir, project.id, index, line, cursor);
        cursor = made.scene.endSec;
        return made;
      });
      for (const scene of scenes) {
        await ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=${scene.color}:s=${target.width}x${target.height}:d=0.1`, "-frames:v", "1", scene.still]);
      }
      for (const mode of modes) {
        const started = Date.now();
        const chosen = createRuleDirector({ language: "vi", composeGraphics: mode.composeGraphics });
        const { plan } = await planEval(project.id, "compose", { dir, footage, beats: null }, chosen);
        const dataDir = join(dir, `data-${project.id}-${mode.composeGraphics}`);
        for (const scene of plan.scenes) {
          const out = join(dir, `${scene.sceneId}-${mode.composeGraphics}.mp4`);
          await renderSceneClip(plan, scene.sceneId, target, {
            dataDir,
            outDir: join(dir, "out"),
            resolvePath: (path) => path,
            projectId: project.id,
            language: "vi",
            composeGraphics: mode.composeGraphics,
            graphicGrain: false,
          }, out);
        }
        const videoSec = plan.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
        const perMin = videoSec > 0 ? ((Date.now() - started) / 1000) / (videoSec / 60) : 0;
        rows.push({
          project: project.id,
          mode: mode.budget,
          composeGraphics: mode.composeGraphics,
          perMin,
          predicted: GRAPHICS_PREDICTED[project.id]![mode.composeGraphics],
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const marker = "## Đồ hoạ off / static / animated (TASK-075)";
  const section = [
    marker,
    "",
    "1080×1920, cache lạnh, một cảnh quay đồ hoạ một lúc. Dự đoán từ RESEARCH-075 (giây render / phút video).",
    "",
    "| Dự án | Chế độ | Đồ hoạ | Đo (s/phút) | Dự đoán (s/phút) |",
    "| --- | --- | --- | ---: | ---: |",
    ...rows.map((row) => `| ${row.project} | ${row.mode} | ${row.composeGraphics} | ${row.perMin.toFixed(1)} | ${row.predicted.toFixed(1)} |`),
    "",
  ].join("\n");
  const old = await readFile(docPath, "utf8").catch(() => "");
  const base = old.includes(marker) ? old.slice(0, old.indexOf(marker)).trimEnd() : old.trimEnd();
  await writeFile(docPath, `${base}\n\n${section}`);
  return { rows };
}

export async function writeEvalDoc(path: string): Promise<{ hyperframes: string | null }> {
  const result = await runComposeEval();
  // Sections written by hand after the generated table (live runs) are kept.
  const old = await readFile(path, "utf8").catch(() => "");
  const kept = old.includes(KEEP_FROM) ? `\n${old.slice(old.indexOf(KEEP_FROM))}` : "";
  await writeFile(path, `${result.markdown}${kept}`);
  return { hyperframes: result.hyperframes };
}

const SAMPLE_SOURCES: { name: string; durationSec: number; source: Shot["source"] }[] = [
  { name: "kinetic-bold", durationSec: 3, source: { kind: "kinetic_text", lines: ["Tiết kiệm 40% chi phí", "chỉ sau một năm"], emphasis: [2], style: "bold" } },
  { name: "kinetic-typewriter", durationSec: 3, source: { kind: "kinetic_text", lines: ["Sự thật là không ai", "nói với bạn điều này"], emphasis: [1, 2], style: "typewriter" } },
  { name: "kinetic-stack", durationSec: 3, source: { kind: "kinetic_text", lines: ["Thứ nhất", "Ngủ đủ giấc", "mỗi đêm"], emphasis: [0, 1], style: "stack" } },
  { name: "chart-bar", durationSec: 4, source: { kind: "chart", chart: "bar", title: "Doanh thu theo quý", labels: ["Quý 1", "Quý 2", "Quý 3", "Quý 4"], values: [120, 180, 150, 240], unit: "tỷ" } },
  { name: "chart-line", durationSec: 4, source: { kind: "chart", chart: "line", title: "Người dùng Internet Việt Nam", labels: ["2020", "2021", "2022", "2023", "2024"], values: [68.2, 72.1, 73.2, 77.9, 79.1], unit: "triệu" } },
  { name: "chart-pie", durationSec: 4, source: { kind: "chart", chart: "pie", title: "Thị phần trình duyệt", labels: ["Chrome", "Safari", "Cốc Cốc", "Khác"], values: [62, 19, 11, 8], unit: "%" } },
  { name: "map-country", durationSec: 4, source: { kind: "map", geo: sampleGeo(), focus: "VN", sublabel: "Đông Nam Á", zoom: "push", highlight: "fill" } },
  { name: "map-city", durationSec: 4, source: { kind: "map", geo: sampleGeo(), focus: "VN-SG", from: "VN", sublabel: "Hơn 9 triệu dân", zoom: "fly", highlight: "glow" } },
  { name: "compare-versus", durationSec: 4, source: { kind: "compare", style: "versus", left: { label: "Thuê nhà", text: "8 triệu mỗi tháng" }, right: { label: "Mua nhà", text: "15 triệu mỗi tháng" }, rightAt: 1.6 } },
  { name: "compare-before", durationSec: 4, source: { kind: "compare", style: "before_after", left: { label: "Trước", text: "Ngủ 5 tiếng, mệt cả ngày" }, right: { label: "Sau", text: "Ngủ đủ 8 tiếng, tỉnh táo" }, rightAt: 1.6 } },
  { name: "compare-myth", durationSec: 4, source: { kind: "compare", style: "myth_fact", left: { label: "Lầm tưởng", text: "Uống cà phê gây mất nước" }, right: { label: "Sự thật", text: "Cà phê vẫn bù nước cho cơ thể" }, rightAt: 1.6 } },
  { name: "quote-ghost", durationSec: 5, source: { kind: "quote_full", quote: "Đầu tư vào tri thức luôn mang lại lợi nhuận cao nhất", speaker: "Benjamin Franklin", role: "Nhà khoa học", emphasis: [3, 4], reveal: "ghost" } },
  { name: "quote-long", durationSec: 6, source: { kind: "quote_full", quote: "Thành công không phải là đích đến cuối cùng, thất bại cũng không phải là dấu chấm hết: điều quan trọng là lòng can đảm để bước tiếp", speaker: "Winston Churchill", reveal: "appear" } },
  { name: "list-bar", durationSec: 5, source: { kind: "list_full", title: "3 thói quen buổi sáng", items: ["Uống một cốc nước ấm", "Vận động 10 phút", "Không xem điện thoại"], highlight: "bar" } },
  { name: "list-six", durationSec: 6, source: { kind: "list_full", title: "Chuẩn bị trước khi đi phỏng vấn", items: ["Tìm hiểu kỹ về công ty", "In sẵn hai bản hồ sơ", "Luyện trả lời câu hỏi thường gặp", "Chuẩn bị trang phục gọn gàng", "Đến sớm 15 phút", "Chuẩn bị câu hỏi cho nhà tuyển dụng"], highlight: "pop" } },
];

function sampleGeo() {
  return MapGeoSchema.parse(JSON.parse(readFileSync(join(composeAssetRoot(), "map", "sample.json"), "utf8")));
}

/**
 * Renders the middle frame of every graphic style for 16:9 and 9:16 with real HyperFrames.
 * Only for the eval harness: a person (or the model) looks at the PNG files.
 */
export async function renderTemplateSamples(outDir: string, only?: string): Promise<{ files: string[]; warnings: string[]; seconds: Record<string, number> }> {
  const dir = await mkdtemp(join(tmpdir(), "vg-samples-"));
  const files: string[] = [];
  const warnings: string[] = [];
  const seconds: Record<string, number> = {};
  await mkdir(outDir, { recursive: true });
  try {
    const sizes = [{ tag: "16x9", width: 1920, height: 1080 }, { tag: "9x16", width: 1080, height: 1920 }];
    for (const [index, sample] of SAMPLE_SOURCES.entries()) {
      if (only && !sample.name.includes(only)) continue;
      for (const size of sizes) {
        const shot = { id: `sample-${index}-${size.tag}`, kind: sample.source.kind, startSec: 0, endSec: sample.durationSec, reason: "sample", source: sample.source } as Shot;
        // The variant is forced so the six samples show all three looks in both aspects.
        const variables = { ...graphicVariables(shot, sample.durationSec, size, {}), variant: (index + (size.tag === "9x16" ? 1 : 0)) % 3 };
        const rendered = await renderComposeTemplate({ dataDir: dir, templateId: sample.source.kind, variables, width: size.width, height: size.height, fps: 30, durationSec: sample.durationSec });
        seconds[`${sample.name}-${size.tag}`] = Math.round(rendered.seconds * 10) / 10;
        if (!rendered.outputPath) { warnings.push(`${sample.name} ${size.tag}: ${rendered.warning ?? "lỗi"}`); continue; }
        for (const [label, at] of [["mid", sample.durationSec / 2], ["end", sample.durationSec - 0.05]] as const) {
          const png = join(outDir, `${sample.name}-${size.tag}-${label}.png`);
          await ffmpeg(["-y", "-ss", at.toFixed(2), "-i", rendered.outputPath, "-frames:v", "1", "-vf", `scale=${size.width / 2}:${size.height / 2}`, png]);
          files.push(png);
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { files, warnings, seconds };
}

const STYLE_PRESET_IDS = ["newsroom", "paper"] as const;

/** One Vietnamese sample per template, so a preset pair can be compared at both aspects. */
function styleSample(templateId: string): { durationSec: number; source: Shot["source"] } | null {
  if (templateId === "list_full") {
    return {
      durationSec: 5,
      source: {
        kind: "list_full",
        title: "Thói quen buổi sáng",
        items: ["Uống một cốc nước ấm", "Vận động mười phút", "Không xem điện thoại", "Ăn sáng đủ chất"],
      },
    };
  }
  if (templateId === "compare") {
    return {
      durationSec: 4,
      source: {
        kind: "compare",
        style: "versus",
        left: { label: "Thuê nhà", text: "8 triệu mỗi tháng" },
        right: { label: "Mua nhà", text: "15 triệu mỗi tháng" },
        rightAt: 1.6,
      },
    };
  }
  if (templateId === "quote_full") {
    return {
      durationSec: 5,
      source: {
        kind: "quote_full",
        quote: "Đầu tư vào tri thức luôn mang lại lợi nhuận cao nhất",
        speaker: "Benjamin Franklin",
        role: "Nhà khoa học",
        emphasis: [3, 4],
        reveal: "ghost",
      },
    };
  }
  if (templateId === "kinetic_text") {
    return {
      durationSec: 4,
      source: {
        kind: "kinetic_text",
        lines: ["Tiết kiệm điện mỗi tháng", "không bật máy lạnh"],
        emphasis: [1],
        style: "bold",
      },
    };
  }
  if (templateId === "chart") {
    return {
      durationSec: 4,
      source: {
        kind: "chart",
        chart: "bar",
        title: "Cà phê mỗi tuần",
        labels: ["Thứ hai", "Thứ tư", "Thứ sáu"],
        values: [2, 5, 3],
        unit: "ly",
      },
    };
  }
  if (templateId === "map") {
    return {
      durationSec: 4,
      source: {
        kind: "map",
        geo: sampleGeo(),
        focus: "VN",
        sublabel: "Đông Nam Á",
        zoom: "push",
        highlight: "fill",
      },
    };
  }
  return null;
}

/**
 * One template at 16:9 and 9:16 for two presets. Same sample path as `renderTemplateSamples`
 * (real HyperFrames, then one PNG of the finished frame). `list_full` keeps its old shot id
 * so an unchanged style still hits the same variant.
 */
export async function renderStyleSamples(outDir: string, templateId = "list_full"): Promise<{ files: string[]; warnings: string[] }> {
  const sample = styleSample(templateId);
  if (!sample) return { files: [], warnings: [`Không có mẫu style cho ${templateId}`] };
  const dir = await mkdtemp(join(tmpdir(), "vg-style-"));
  const files: string[] = [];
  const warnings: string[] = [];
  const { durationSec, source } = sample;
  const sizes = [{ tag: "16x9", width: 1920, height: 1080 }, { tag: "9x16", width: 1080, height: 1920 }];
  await mkdir(outDir, { recursive: true });
  try {
    const only = process.env.VG_STYLE_SAMPLE_ONLY;
    for (const presetId of STYLE_PRESET_IDS) {
      const pack = stylePackFromChoices({ id: presetId, name: presetId, presetId });
      for (const size of sizes) {
        if (only && `${presetId}-${size.tag}` !== only) continue;
        const shot = { id: templateId === "list_full" ? "style-list" : `style-${templateId}`, kind: source.kind, startSec: 0, endSec: durationSec, reason: "sample", source } as Shot;
        const variables = graphicVariables(shot, durationSec, size, {
          projectId: "style-sample",
          profileId: "style-profile",
          recipeId: "listicle",
          stylePack: pack,
        });
        const rendered = await renderComposeTemplate({
          dataDir: join(dir, `${presetId}-${size.tag}`),
          templateId: source.kind,
          variables,
          width: size.width,
          height: size.height,
          fps: 30,
          durationSec,
        });
        if (!rendered.outputPath) {
          warnings.push(`${presetId} ${size.tag}: ${rendered.warning ?? "lỗi"}`);
          continue;
        }
        const png = join(outDir, `${presetId}-${size.tag}.png`);
        await ffmpeg(["-y", "-ss", (durationSec - 0.15).toFixed(2), "-i", rendered.outputPath, "-frames:v", "1", png]);
        files.push(png);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { files, warnings };
}
