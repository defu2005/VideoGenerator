import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const css = `html,body{margin:0;background:transparent;color:#fff;font-family:"Be Vietnam Pro",sans-serif}
#root{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8%}
h1,h2,p,blockquote{margin:0;max-width:90%}
#bar{height:8px;width:40%}
#fill{height:10px;width:100%}
#chart{display:flex;align-items:flex-end;gap:12px;height:220px}
.col{width:48px}`;

const readVars = `const v = (window.__hyperframes && window.__hyperframes.getVariables && window.__hyperframes.getVariables()) || {};`;
const register = `window.__timelines = { main: tl };`;

const templates = [
  {
    meta: { id: "title_card", version: 1, nameVi: "Thẻ tiêu đề", descriptionVi: "Tiêu đề mở đầu, tối đa hai dòng.", kinds: ["overlay", "fullscreen"], minDurationSec: 2, maxDurationSec: 6, defaultDurationSec: 3, safeArea: "center", origin: "written for this app", variables: [{ name: "title", type: "string", maxLength: 48, default: "" }, { name: "subtitle", type: "string", maxLength: 48, default: "" }, { name: "color", type: "color", default: "#F8FAFC" }] },
    body: `<h1 id="line1"></h1><p id="line2"></p><script>${readVars}
document.getElementById("line1").textContent = v.title || "";
document.getElementById("line2").textContent = v.subtitle || "";
document.getElementById("line1").style.color = v.color || "#F8FAFC";
const tl = gsap.timeline({ paused: true });
tl.from("#line1", { y: 36, opacity: 0, duration: 0.5 }, 0);
tl.from("#line2", { y: 24, opacity: 0, duration: 0.45 }, 0.2);
${register}</script>`,
  },
  {
    meta: { id: "kinetic_word", version: 1, nameVi: "Chữ động", descriptionVi: "Một tới ba chữ lớn thay cho chú thích ASS.", kinds: ["overlay"], minDurationSec: 0.8, maxDurationSec: 4, defaultDurationSec: 1.6, safeArea: "center", origin: "written for this app", variables: [{ name: "text", type: "string", maxLength: 24, default: "" }, { name: "color", type: "color", default: "#F5C518" }] },
    body: `<div id="word"></div><div id="bar"></div><script>${readVars}
const el = document.getElementById("word");
el.textContent = v.text || "";
el.style.color = v.color || "#F5C518";
const tl = gsap.timeline({ paused: true });
tl.from("#word", { scale: 0.85, filter: "blur(8px)", opacity: 0, duration: 0.35 }, 0);
tl.from("#bar", { scaleX: 0, duration: 0.4 }, 0.15);
${register}</script>`,
  },
  {
    meta: { id: "number_counter", version: 1, nameVi: "Số đếm", descriptionVi: "Đếm tới một giá trị, có tiền tố và hậu tố.", kinds: ["overlay"], minDurationSec: 1.5, maxDurationSec: 5, defaultDurationSec: 2.5, safeArea: "center", origin: "written for this app", variables: [{ name: "value", type: "number", default: 0 }, { name: "prefix", type: "string", maxLength: 8, default: "" }, { name: "suffix", type: "string", maxLength: 8, default: "" }, { name: "label", type: "string", maxLength: 32, default: "" }, { name: "color", type: "color", default: "#F8FAFC" }] },
    body: `<div id="num"></div><p id="label"></p><script>${readVars}
const state = { n: 0 };
const el = document.getElementById("num");
el.style.color = v.color || "#F8FAFC";
document.getElementById("label").textContent = v.label || "";
const tl = gsap.timeline({ paused: true });
tl.to(state, { n: Number(v.value) || 0, duration: 1.4, onUpdate() { el.textContent = (v.prefix || "") + Math.round(state.n) + (v.suffix || ""); } }, 0);
${register}</script>`,
  },
  {
    meta: { id: "lower_third", version: 1, nameVi: "Tên dưới", descriptionVi: "Tên hoặc nguồn và một dòng phụ.", kinds: ["overlay"], minDurationSec: 2, maxDurationSec: 8, defaultDurationSec: 4, safeArea: "lower", origin: "written for this app", variables: [{ name: "name", type: "string", maxLength: 32, default: "" }, { name: "sub", type: "string", maxLength: 40, default: "" }, { name: "color", type: "color", default: "#38BDF8" }] },
    body: `<div id="bar"></div><strong id="name"></strong><p id="sub"></p><script>${readVars}
document.getElementById("name").textContent = v.name || "";
document.getElementById("sub").textContent = v.sub || "";
document.getElementById("bar").style.background = v.color || "#38BDF8";
const tl = gsap.timeline({ paused: true });
tl.from("#bar", { x: -80, opacity: 0, duration: 0.35 }, 0);
tl.from("#name", { x: -20, opacity: 0, duration: 0.3 }, 0.15);
${register}</script>`,
  },
  {
    meta: { id: "list_item", version: 1, nameVi: "Mục danh sách", descriptionVi: "Huy hiệu số và tiêu đề mục.", kinds: ["overlay"], minDurationSec: 1.5, maxDurationSec: 6, defaultDurationSec: 3, safeArea: "lower", origin: "written for this app", variables: [{ name: "badge", type: "string", maxLength: 8, default: "#1" }, { name: "title", type: "string", maxLength: 40, default: "" }, { name: "color", type: "color", default: "#F8FAFC" }] },
    body: `<span id="badge"></span><span id="title"></span><script>${readVars}
document.getElementById("badge").textContent = v.badge || "#1";
document.getElementById("title").textContent = v.title || "";
document.getElementById("title").style.color = v.color || "#F8FAFC";
const tl = gsap.timeline({ paused: true });
tl.from("#badge", { scale: 0.6, opacity: 0, duration: 0.3 }, 0);
tl.from("#title", { y: 16, opacity: 0, duration: 0.35 }, 0.12);
${register}</script>`,
  },
  {
    meta: { id: "quote_card", version: 1, nameVi: "Trích dẫn", descriptionVi: "Câu trích và tên người nói.", kinds: ["overlay"], minDurationSec: 2, maxDurationSec: 8, defaultDurationSec: 4, safeArea: "center", origin: "written for this app", variables: [{ name: "quote", type: "string", maxLength: 80, default: "" }, { name: "author", type: "string", maxLength: 32, default: "" }, { name: "color", type: "color", default: "#F8FAFC" }] },
    body: `<blockquote id="quote"></blockquote><cite id="author"></cite><script>${readVars}
document.getElementById("quote").textContent = v.quote || "";
document.getElementById("author").textContent = v.author || "";
document.getElementById("quote").style.color = v.color || "#F8FAFC";
const tl = gsap.timeline({ paused: true });
tl.from("#quote", { opacity: 0, duration: 0.5 }, 0);
tl.from("#author", { opacity: 0, duration: 0.4 }, 0.3);
${register}</script>`,
  },
  {
    meta: { id: "bar_chart", version: 1, nameVi: "Biểu đồ cột", descriptionVi: "Hai tới năm cột, giá trị đã chuẩn hoá.", kinds: ["overlay"], minDurationSec: 2, maxDurationSec: 8, defaultDurationSec: 4, safeArea: "center", origin: "written for this app", variables: [{ name: "labels", type: "string", maxLength: 80, default: "" }, { name: "values", type: "string", maxLength: 40, default: "" }, { name: "color", type: "color", default: "#38BDF8" }] },
    body: `<div id="chart"></div><script>${readVars}
const labels = String(v.labels || "").split("|");
const values = String(v.values || "").split(",").map(Number);
const chart = document.getElementById("chart");
values.forEach((value, index) => {
  const col = document.createElement("div");
  col.className = "col";
  col.style.height = "8px";
  col.dataset.h = String(Math.max(8, (value || 0) * 180));
  col.style.background = v.color || "#38BDF8";
  const cap = document.createElement("span");
  cap.textContent = labels[index] || "";
  col.appendChild(cap);
  chart.appendChild(col);
});
const tl = gsap.timeline({ paused: true });
tl.to(".col", { height: (i, el) => el.dataset.h, duration: 0.8, stagger: 0.08 }, 0);
${register}</script>`,
  },
  {
    meta: { id: "progress_bar", version: 1, nameVi: "Thanh tiến độ", descriptionVi: "Thanh mỏng trên cùng suốt video dọc.", kinds: ["overlay"], minDurationSec: 1, maxDurationSec: 3600, defaultDurationSec: 30, safeArea: "top", origin: "written for this app", variables: [{ name: "color", type: "color", default: "#F5C518" }] },
    body: `<div id="track"><div id="fill"></div></div><script>${readVars}
document.getElementById("fill").style.background = v.color || "#F5C518";
const tl = gsap.timeline({ paused: true });
tl.fromTo("#fill", { scaleX: 0 }, { scaleX: 1, duration: 1, transformOrigin: "left center" }, 0);
${register}</script>`,
  },
  {
    meta: { id: "end_card", version: 1, nameVi: "Thẻ kết", descriptionVi: "Lời kêu gọi theo dõi và tên kênh, 3 giây cuối.", kinds: ["overlay", "fullscreen"], minDurationSec: 2, maxDurationSec: 4, defaultDurationSec: 3, safeArea: "full", origin: "written for this app", variables: [{ name: "line", type: "string", maxLength: 40, default: "Theo dõi để xem thêm" }, { name: "channel", type: "string", maxLength: 32, default: "" }, { name: "color", type: "color", default: "#F8FAFC" }] },
    body: `<h2 id="line"></h2><p id="channel"></p><script>${readVars}
document.getElementById("line").textContent = v.line || "Theo dõi để xem thêm";
document.getElementById("channel").textContent = v.channel || "";
document.getElementById("line").style.color = v.color || "#F8FAFC";
const tl = gsap.timeline({ paused: true });
tl.from("#line", { y: 20, opacity: 0, duration: 0.45 }, 0);
tl.from("#channel", { opacity: 0, duration: 0.35 }, 0.2);
${register}</script>`,
  },
];

for (const template of templates) {
  const dir = join(root, template.meta.id);
  mkdirSync(dir, { recursive: true });
  const vars = {};
  for (const item of template.meta.variables) {
    vars[item.name] = { type: item.type, default: item.default, ...(item.maxLength ? { maxLength: item.maxLength } : {}) };
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@font-face{font-family:"Be Vietnam Pro";src:url("font.woff2") format("woff2");font-weight:400}@font-face{font-family:"Be Vietnam Pro";src:url("font-bold.woff2") format("woff2");font-weight:700}${css}</style><script src="gsap.min.js"></script></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="1080" data-height="1920" data-fps="30" data-composition-variables='${JSON.stringify(vars)}'>${template.body}</div></body></html>\n`;
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(template.meta, null, 2)}\n`);
}
console.log(templates.length);
