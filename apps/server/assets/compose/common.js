/* Shared runtime for the compose templates (TASK-067b part 2).
 * Loaded by kinetic_text and chart. Everything is laid out in pixels from the
 * composition size, so the result does not depend on when the fonts arrive. */
window.VGInit = function () {
  const hf = window.__hyperframes;
  const v = (hf && hf.getVariables && hf.getVariables()) || {};
  const root = document.getElementById("root");
  const W = Number(root.dataset.width) || 1920;
  const H = Number(root.dataset.height) || 1080;
  const D = Number(v.durationSec) || Number(root.dataset.duration) || 3;
  const END = Math.max(0.1, D - 0.2);
  const portrait = H > W;
  const variant = [0, 1, 2].includes(Number(v.variant)) ? Number(v.variant) : 0;
  const safe = Object.assign(
    { top: 0.06, left: 0.06, right: portrait ? 0.12 : 0.06, bottom: portrait ? 0.3 : 0.22 },
    v.safe || {},
  );
  const C = Object.assign(
    { bg: "#0F172A", bgLight: "#1E2A44", bgDark: "#070B14", text: "#FFFFFF", accent: "#F5C518" },
    v.colors || {},
  );
  const LH = 1.3;
  const FONT = '"Be Vietnam Pro","Noto Sans","Noto Sans CJK SC","Noto Sans Arabic","Noto Sans Devanagari","Noto Sans Thai",sans-serif';
  // Style tokens (TASK-106): resolved on the server, see packages/shared/src/style/resolve.ts.
  // `S` is null only for a caller that sends no style. list_full then uses its own default.
  const S = v.style && typeof v.style === "object" ? v.style : null;
  const AX = (S && S.axes) || {};
  // The ground follows the resolved palette. brandColor and v.colors stay for older readers.
  if (S && S.color) {
    C.bg = S.color.bg;
    C.bgLight = S.color.bgAlt;
    C.bgDark = S.color.bgDeep;
    C.text = S.color.text;
    C.accent = S.color.accent;
    if (S.color.textMuted) C.muted = S.color.textMuted;
  }
  const LINE = S ? S.type.lineHeight : LH;
  const FAMILY = S ? S.font.body.family : FONT;
  /** The shot's value on a variation axis: a value fixed in the shot source wins, then the picked one, then the first. */
  const axis = (name, allowed, given) => (allowed.includes(given) ? given : allowed.includes(AX[name]) ? AX[name] : allowed[0]);
  /** `hex` with an alpha byte (0–255). Decoration alphas pass `soft` so the background intensity token scales them. */
  const K = S ? S.background.intensity : 1;
  const alpha = (hex, byte, soft) => hex + Math.max(0, Math.min(255, Math.round(byte * (soft ? K : 1)))).toString(16).padStart(2, "0");

  const css = document.createElement("style");
  const face = (file, weight, range) =>
    `@font-face{font-family:"Be Vietnam Pro";src:url("${file}") format("woff2");font-weight:${weight};unicode-range:${range}}`;
  const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  const LATIN_EXT = "U+0100-0101,U+0104-010F,U+0112-0127,U+012A-0130,U+0132-0167,U+016A-019F,U+01A2-01AE,U+01B1-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+2020,U+20A0-20AA,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
  const VIET = "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB";
  css.textContent = [
    face("font-latin.woff2", 400, LATIN), face("font-latin-bold.woff2", 700, LATIN),
    face("font-latin-ext.woff2", 400, LATIN_EXT), face("font-latin-ext-bold.woff2", 700, LATIN_EXT),
    face("font.woff2", 400, VIET), face("font-bold.woff2", 700, VIET),
    `html,body{margin:0;background:${C.bg}}`,
    `#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;color:${C.text};font-family:${FAMILY};line-height:${LINE}}`,
    ".layer{position:absolute;inset:-6%}",
    "#stage{position:absolute;display:flex;box-sizing:border-box}",
    "#stage *{box-sizing:border-box;line-height:inherit}",
    // Type tokens as CSS variables, so a template's stylesheet holds no fixed weight, tracking or case.
    S ? `#root{--vg-w-display:${S.font.display.weight};--vg-w-body:${S.font.body.weight};--vg-track-display:${S.type.trackDisplay}em;--vg-track-caps:${S.type.trackCaps}em;--vg-case-display:${S.type.caseDisplay === "upper" ? "uppercase" : "none"}}` : "",
  ].join("\n");
  document.head.appendChild(css);

  const tl = gsap.timeline({ paused: true });
  /** Start time for a tween of length d so it is over by END. */
  const at = (t, d) => Math.max(0, Math.min(Number(t) || 0, END - (d || 0)));
  const el = (tag, cls, parent, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };

  // Background: one treatment per shot, each drifting slowly so a held graphic is never a frozen frame.
  // The treatment is the `background` axis; without a style it follows the old variant number.
  const bgKind = ["glow", "beam", "shapes", "flat", "grid"].includes(AX.background) ? AX.background : ["glow", "beam", "shapes"][variant];
  const DR = S ? S.motion.drift : 1;
  const base = el("div", "layer", root);
  const drift = Math.max(0.1, END);
  if (bgKind === "glow") {
    base.style.background = `radial-gradient(120% 95% at 28% 18%, ${C.bgLight} 0%, ${C.bg} 52%, ${C.bgDark} 100%)`;
    const glow = el("div", "layer", root);
    glow.style.background = `radial-gradient(42% 36% at 78% 30%, ${alpha(C.accent, 0x22, true)} 0%, ${C.accent}00 100%)`;
    tl.fromTo(glow, { xPercent: 3 * DR, yPercent: -2 * DR }, { xPercent: -3 * DR, yPercent: 2 * DR, duration: drift, ease: "none" }, 0);
  } else if (bgKind === "beam") {
    base.style.background = `linear-gradient(135deg, ${C.bgLight} 0%, ${C.bg} 46%, ${C.bgDark} 100%)`;
    // Grain belongs to this treatment. The render can turn it off (grain:false), and so can the style.
    // A small seeded noise tile. (An SVG turbulence filter with a blend mode made
    // every frame 4–5× slower to capture.)
    if (v.grain !== false && (!S || S.background.grain)) {
      const tile = document.createElement("canvas");
      tile.width = tile.height = 128;
      const ctx2d = tile.getContext("2d");
      if (ctx2d) {
        const image = ctx2d.createImageData(128, 128);
        let seed = 20261111;
        // The grain is white on a dark ground and dark on a light one.
        const tone = S && S.color.mode === "light" ? 0 : 255;
        for (let i = 0; i < image.data.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          image.data[i] = image.data[i + 1] = image.data[i + 2] = tone;
          image.data[i + 3] = (seed >>> 24) % 22;
        }
        ctx2d.putImageData(image, 0, 0);
        const grain = el("div", "", root);
        grain.style.cssText = `position:absolute;inset:0;background-image:url(${tile.toDataURL("image/png")});background-size:256px 256px`;
      }
    }
    const beam = el("div", "layer", root);
    beam.style.background = `linear-gradient(115deg, ${C.accent}00 38%, ${alpha(C.accent, 0x14, true)} 50%, ${C.accent}00 62%)`;
    tl.fromTo(beam, { xPercent: -5 * DR }, { xPercent: 5 * DR, duration: drift, ease: "none" }, 0);
  } else if (bgKind === "shapes") {
    base.style.background = `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDark} 100%)`;
    const m = Math.min(W, H);
    const shape = (size, x, y, fill, ring) => {
      const node = el("div", "", root);
      node.style.cssText = `position:absolute;width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px;border-radius:50%;` +
        (ring ? `border:${Math.max(2, m * 0.003)}px solid ${alpha(C.accent, 0x33, true)}` : `background:${fill}`);
      return node;
    };
    const a = shape(m * 0.8, W * 0.92, H * 0.08, alpha(C.accent, 0x12, true));
    const b = shape(m * 0.55, W * 0.03, H * 0.93, alpha(C.bgLight, 0x99, true));
    const c = shape(m * 0.36, W * 0.86, H * 0.14, "", true);
    tl.fromTo(a, { x: 0, y: 0 }, { x: -W * 0.03 * DR, y: H * 0.02 * DR, duration: drift, ease: "none" }, 0);
    tl.fromTo(b, { x: 0, y: 0 }, { x: W * 0.025 * DR, y: -H * 0.02 * DR, duration: drift, ease: "none" }, 0);
    tl.fromTo(c, { scale: 1 - 0.06 * DR }, { scale: 1 + 0.04 * DR, duration: drift, ease: "none" }, 0);
  } else if (bgKind === "grid") {
    // Ruled paper: thin lines one cell apart, sliding by one cell over the shot.
    base.style.background = `linear-gradient(180deg, ${C.bgLight} 0%, ${C.bg} 100%)`;
    const cell = Math.round(Math.min(W, H) * 0.085);
    const line = alpha(C.text, 0x14, true);
    const lines = el("div", "layer", root);
    lines.style.cssText += `;background-image:linear-gradient(${line} 2px, transparent 2px),linear-gradient(90deg, ${line} 2px, transparent 2px);background-size:${cell}px ${cell}px`;
    tl.fromTo(lines, { x: 0, y: 0 }, { x: -cell * DR, y: -cell * DR, duration: drift, ease: "none" }, 0);
  } else {
    // flat: the plain ground with a soft edge, the cheapest frame to capture.
    base.style.background = `radial-gradient(130% 130% at 50% 45%, ${C.bg} 55%, ${K > 0 ? C.bgDark : C.bg} 100%)`;
  }
  tl.fromTo(base, { scale: 1 }, { scale: 1 + 0.05 * DR, duration: drift, ease: "none" }, 0);

  // Safe box: subtitles own the bottom band, platform buttons the right edge on 9:16.
  const box = {
    x: Math.round(W * safe.left),
    y: Math.round(H * safe.top),
    w: Math.round(W * (1 - safe.left - safe.right)),
    h: Math.round(H * (1 - safe.top - safe.bottom)),
  };
  const stage = el("div", "", root);
  stage.id = "stage";
  stage.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;

  /** Largest font size (px) at which the element fits maxW × maxH in at most maxLines lines. */
  const fitText = (node, o) => {
    const lh = o.lh || LINE;
    const ok = (fs) => {
      node.style.fontSize = fs + "px";
      const lines = Math.round(node.offsetHeight / (fs * lh));
      return node.scrollWidth <= Math.ceil(o.maxW) + 1 && node.offsetHeight <= o.maxH + 1 && lines <= (o.maxLines || 99);
    };
    let lo = Math.max(8, Math.floor(o.minFs || 14));
    let hi = Math.max(lo, Math.floor(o.maxFs));
    if (ok(hi)) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ok(mid)) lo = mid; else hi = mid;
    }
    ok(lo);
    return lo;
  };

  /**
   * Run a layout pass now, and again whenever the text metrics change (a web font arrived).
   * The check runs on every timeline update, so it does not rely on font events firing before
   * the first frame is captured. Layout passes change sizes only, never timings.
   */
  const passes = [];
  const probes = [400, 700].map((weight) => {
    const probe = el("span", "", stage, "Ắg mẫu Wq 0123 ửỡ");
    probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font-size:100px;font-weight:${weight}`;
    return probe;
  });
  let metrics = "";
  const relayout = () => {
    const now = probes.map((probe) => probe.offsetWidth).join(",");
    if (now === metrics) return;
    metrics = now;
    passes.forEach((fn) => { try { fn(); } catch (error) { /* keep the previous layout */ } });
  };
  const layout = (fn) => {
    fn();
    passes.push(fn);
  };
  metrics = probes.map((probe) => probe.offsetWidth).join(",");
  tl.eventCallback("onUpdate", relayout);
  if (document.fonts && document.fonts.load) {
    [400, 700].forEach((weight) => document.fonts.load(`${weight} 40px "Be Vietnam Pro"`, "Ắg mẫu").then(relayout, relayout));
    if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", relayout);
  }

  /**
   * Start time (s) of each of `count` items. `given` may be numbers or { t } objects;
   * when it does not match `count`, the items spread evenly over `spread` × the shot.
   * Times never go backwards and leave `enter` seconds for the last entrance. (TASK-070)
   */
  const times = (count, given, o) => {
    const opt = o || {};
    const enter = opt.enter == null ? 0.4 : opt.enter;
    const last = Math.max(0, END - enter);
    const raw = Array.isArray(given) ? given.map((x) => Number(x && typeof x === "object" ? x.t : x)) : [];
    if (count > 0 && raw.length === count && raw.every((t) => Number.isFinite(t) && t >= 0)) {
      let prev = 0;
      return raw.map((t) => (prev = Math.max(prev, Math.min(last, t))));
    }
    const from = Math.min(last, Math.max(0, Number(opt.from) || 0));
    const to = Math.min(last, Math.max(from, D * (opt.spread == null ? 0.6 : opt.spread)));
    return Array.from({ length: count }, (_, i) => (count <= 1 ? from : from + (i / (count - 1)) * (to - from)));
  };

  /**
   * Entrance of a main element, in the channel's motion personality: the `entrance` axis picks
   * the move, the motion tokens give its length, ease and travel. Returns the tween length.
   */
  const M = S ? S.motion : { fast: 0.25, base: 0.32, slow: 0.45, enter: "power3.out", move: "power2.out", exit: "power2.in", emphasis: "back.out(2.6)", entrances: ["slide"], distance: Math.round(Math.min(W, H) * 0.05), drift: 1 };
  const enter = (node, t, o) => {
    const opt = o || {};
    const kind = axis("entrance", [M.entrances[0], "slide", "rise", "scale", "fade"], opt.kind);
    const d = opt.duration || M.base;
    const from = { opacity: 0, duration: d, ease: M.enter };
    if (kind === "slide") from.x = -M.distance;
    else if (kind === "rise") from.y = M.distance;
    else if (kind === "scale") Object.assign(from, { scale: 0.86, transformOrigin: opt.origin || "50% 50%" });
    tl.from(node, from, at(t, d));
    return d;
  };

  const finish = () => {
    tl.set({}, {}, D); // the timeline spans the whole shot, so the last frame holds
    window.__timelines = { main: tl };
  };

  /**
   * Resolved style, or the same ramp list_full uses when a caller sends no variables.style.
   * Sets the type CSS variables in that fallback so a template's stylesheet can stay on tokens.
   */
  const fallbackStyle = () => {
    if (S) return S;
    const node = document.getElementById("root");
    if (node) {
      node.style.setProperty("--vg-w-display", "700");
      node.style.setProperty("--vg-w-body", "400");
      node.style.setProperty("--vg-track-display", "-0.01em");
      node.style.setProperty("--vg-track-caps", "0.08em");
      node.style.setProperty("--vg-case-display", "none");
    }
    const short = Math.min(W, H);
    const basePx = short * (portrait ? 0.04 : 0.042);
    const step = (n) => Math.round(basePx * Math.pow(1.3, n));
    const muted = C.muted || C.text;
    return {
      color: {
        mode: "dark", bg: C.bg, bgAlt: C.bgLight, bgDeep: C.bgDark, text: C.text, textMuted: muted,
        accent: C.accent, onAccent: C.bgDark, accent2: C.accent, positive: C.accent, negative: C.text,
        series: [C.accent, C.text, muted],
      },
      type: {
        xs: step(-1), sm: step(0), md: step(1), lg: step(2), xl: step(3), xxl: step(4),
        lineHeight: LINE, lineHeightTight: 1.22, trackDisplay: -0.01, trackCaps: 0.08, caseDisplay: "none",
      },
      layout: { family: "editorial", align: "start", density: 1, radius: 0.4, stroke: 1 },
      space: Math.round(basePx),
      safe,
    };
  };

  return { v, W, H, D, END, LH: LINE, portrait, variant, safe, C, box, stage, tl, at, el, fitText, layout, times, finish, S, M, axis, alpha, enter, fallbackStyle };
};
