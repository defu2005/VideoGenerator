/**
 * Static checks on an operator skill draft (TASK-074b-1, rules in docs/cursor/TASK-074.md §4.1).
 * Plain string and word counting. No LLM, no dependency.
 */

/** The five forbidden rules from TASK-074 §4.1, each with Vietnamese and English phrasings. */
export const BANNED_PHRASES: ReadonlyArray<{ rule: string; phrases: readonly string[] }> = [
  {
    rule: "approve",
    phrases: [
      "tự duyệt", "tự phê duyệt", "tự động duyệt", "không cần duyệt", "không cần người dùng duyệt", "bỏ qua bước duyệt",
      "auto-approve", "auto approve", "self-approve", "approve it yourself", "approve without", "without approval",
    ],
  },
  {
    rule: "raise budgets",
    phrases: [
      "tăng ngân sách", "nâng ngân sách", "tăng hạn mức", "nâng hạn mức",
      "raise the budget", "raise budgets", "increase the budget", "increase budgets",
    ],
  },
  {
    rule: "paid_fallback",
    phrases: [
      "bật paid_fallback", "bật paid fallback", "kích hoạt paid_fallback", "turn on paid_fallback",
      "turn on paid fallback", "enable paid_fallback", "enable paid fallback",
    ],
  },
  {
    rule: "skip a check",
    phrases: [
      "bỏ qua kiểm tra", "bỏ qua bước kiểm", "bỏ qua việc kiểm", "bỏ qua check",
      "skip the check", "skip checks", "skip the checks", "skip validation", "bypass the check", "bypass checks",
    ],
  },
  {
    rule: "touch the protected project",
    phrases: [
      "sửa dự án được bảo vệ", "chỉnh dự án được bảo vệ", "ghi vào dự án được bảo vệ",
      "modify the protected project", "edit the protected project", "touch the protected project",
      "write to the protected project", "change the protected project",
    ],
  },
];

/** Negation words. A phrase preceded by one of these in the same clause is a prohibition, not an instruction. */
const NEGATION = /(^|[^\p{L}\p{N}_])(không|chớ|đừng|cấm|never|not|no|don't|do not|must not|cannot|can't)(?![\p{L}\p{N}_])/u;
const CLAUSE_BREAK = /[.;:!?,|]/g;
/**
 * TASK-152: a connector ends the negation's reach, so "không dừng lại thì tự duyệt" and "không cần hỏi mà tự duyệt"
 * are not negated. "and" / "và" / "mà" are included: "do not ask and auto approve" reads as an instruction, so
 * it is flagged. "or" is left out on purpose: "never ask or auto approve" is a prohibition on both.
 */
const CONNECTOR = /(^|\s)(thì|then|nhưng|but|rồi|mà|và|and)(?=\s|$)/g;
/** TASK-152: a negation counts only when it is within this many words before the phrase. */
const NEGATION_WINDOW = 4;

/** True when a negation sits within NEGATION_WINDOW words before idx, in the same clause and after the last connector. */
function negatedBefore(line: string, idx: number): boolean {
  const before = line.slice(0, idx);
  let start = 0;
  for (const match of before.matchAll(CLAUSE_BREAK)) start = (match.index ?? 0) + 1;
  let segment = before.slice(start);
  for (const match of segment.matchAll(CONNECTOR)) segment = segment.slice((match.index ?? 0) + match[0].length);
  const words = segment.trim().split(/\s+/).filter(Boolean).slice(-NEGATION_WINDOW);
  return NEGATION.test(words.join(" "));
}

/** NFC so Vietnamese precomposed and decomposed forms match the same phrase. */
const normLine = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ");

/**
 * Returns the first forbidden rule and the phrase that matched, or null.
 * A match preceded by a negation in the same clause (for example "không tự duyệt", "never raise the budget")
 * is treated as a prohibition and is not flagged.
 */
export function findBannedPhrase(markdown: string): { rule: string; phrase: string } | null {
  for (const rawLine of [...frontmatterDescription(markdown), ...bodyLines(markdown)]) {
    const line = normLine(rawLine);
    for (const entry of BANNED_PHRASES) {
      for (const phrase of entry.phrases) {
        let idx = line.indexOf(phrase);
        while (idx !== -1) {
          if (!negatedBefore(line, idx)) return { rule: entry.rule, phrase };
          idx = line.indexOf(phrase, idx + 1);
        }
      }
    }
  }
  return null;
}

/**
 * The skill body: every line after the YAML frontmatter. §4.1 says "the body may not ..."; the
 * frontmatter holds triggers and descriptions, which are the user's routing words (for example the
 * built-in trigger "tự duyệt đề xuất"), so the rules are checked on the body only.
 */
export function bodyLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") i++;
    i++;
  }
  return lines.slice(i);
}

/** TASK-152: the frontmatter description line, checked like body text. Triggers stay out (they are routing words). */
export function frontmatterDescription(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const out: string[] = [];
  for (let i = 1; i < lines.length && lines[i]?.trim() !== "---"; i++) {
    const match = /^description:\s*(.*)$/.exec(lines[i] ?? "");
    if (match?.[1]) out.push(match[1].replace(/^["']|["']$/g, "").trim());
  }
  return out;
}

/**
 * Quoted spans in the body: text inside straight or curly double quotes, or a run of adjacent markdown
 * blockquote lines (joined into one span). TASK-152: a quote may wrap over soft-wrapped lines of one
 * paragraph; the paragraph is joined before matching. Fenced code is not a quote.
 */
export function quotedSpans(markdown: string): string[] {
  const spans: string[] = [];
  const lines = bodyLines(markdown);
  let quote: string[] = [];
  let para: string[] = [];
  let inFence = false;
  const flushQuote = () => {
    if (quote.length) spans.push(quote.join(" ").trim());
    quote = [];
  };
  const flushPara = () => {
    if (para.length) {
      for (const match of para.join(" ").matchAll(/"([^"]+)"|“([^”]+)”/g)) {
        spans.push((match[1] ?? match[2] ?? "").trim());
      }
    }
    para = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { flushQuote(); flushPara(); inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s*>/.test(line)) {
      flushPara();
      const inner = line.replace(/^\s*>\s?/, "").trim();
      if (inner) quote.push(inner);
      continue;
    }
    flushQuote();
    if (!line.trim()) { flushPara(); continue; }
    para.push(line.trim());
  }
  flushQuote();
  flushPara();
  return spans;
}

export const MAX_QUOTED_WORDS = 25;

/** Returns the first quoted span longer than MAX_QUOTED_WORDS words, or null. Per span (advisor ruling 2026-11-19). */
export function findLongQuote(markdown: string): { span: string; words: number } | null {
  for (const span of quotedSpans(markdown)) {
    const words = span.split(/\s+/).filter(Boolean).length;
    if (words > MAX_QUOTED_WORDS) return { span, words };
  }
  return null;
}
