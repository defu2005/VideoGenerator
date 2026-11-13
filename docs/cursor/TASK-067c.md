# TASK-067c — Cursor: compose helpers (language packs, number parser, variety pass)

**Who:** Cursor, model **grok-4.7-medium** (not high/xhigh). Difficulty: medium. Everything here is pure code with exact tests, so it is split out of TASK-067b Part 1 to save the Fable budget. Fable then uses these helpers to build the directors.

**Prerequisite:** `docs/tasks/TASK-067a.done` exists. Read `docs/cursor/README.md` (rules, commands, done checklist), then this file, then `docs/compose/README.md`. Read only these code files: `packages/shared/src/compose/{schema,words,metrics,index}.ts`. Never open a file over 300 lines whole.

**Parallel work:** Codex is doing TASK-073a in `packages/shared/src/knowledge/**`, `apps/server/src/knowledge/**` and the DB. Do not touch those or any migration.

## 0. Hard rules

- **Allowed files:** `packages/shared/src/compose/lang/**`, `packages/shared/src/compose/numbers.ts`, `packages/shared/src/compose/variety.ts`, their `*.test.ts` files, and new export lines in `packages/shared/src/compose/index.ts`. Plus one paragraph in `docs/compose/README.md` (§5). Nothing else.
- Do not change `schema.ts`, `words.ts`, `metrics.ts`, `pacing.ts`, `beats.ts` or anything in `apps/server/src/compose/`. If they block you, stop and report.
- No commit or push. No new npm dependency. No DB change. Do not touch `.env`, `.claude/`, `data/` or `scripts/`.
- Tests: no network, no LLM. Every function is pure and deterministic (same input → same output, no `Date`, no random).

## Mã nguồn mở có sẵn

No new dependency is allowed, so these are references for the logic only. Copy only from MIT/BSD/Apache code and keep the attribution in a comment.
- **compromise** (MIT, `spencermountain/compromise`), `plugins/numbers`: how English number words ("1.5 million", "twenty percent") are folded into values. Read it for the English pack rules.
- **read-vietnamese-number** / **vietnamese-number** style libraries (MIT; check the licence before copying): they turn numbers into Vietnamese words. Use them in reverse to check the Vietnamese scale words (`nghìn`, `ngàn`, `triệu`, `tỷ`/`tỉ`, `phần trăm`).
- **Intl.NumberFormat** (built in): do not use it to parse; the pack decides separators.
If you find a better permissive project, list it in the report (README rule 11). Do not add it.

## 1. Language packs — `packages/shared/src/compose/lang/`

```ts
export type ComposeLangPack = {
  code: string;                    // "vi", "en"
  decimalSep: "," | ".";           // vi ",", en "."
  thousandSep: "." | ",";          // vi ".", en ","
  scaleWords: Record<string, number>;   // vi: nghìn/ngàn 1e3, triệu 1e6, tỷ/tỉ 1e9; en: thousand, million, billion (+ k/m/bn suffixes)
  percentWords: string[];          // vi: "phần trăm"; en: "percent", "per cent"
  timesWords: { before: string[]; after: string[] }; // vi: "gấp" … "lần"; en: … "times"
  yearMarkers: string[];           // vi: "năm"; en: "in", "since", "by"
  ordinals: string[];              // lowercase sentence starts: vi "thứ nhất", "thứ hai", …, "số 1", "đầu tiên"; en "first", "second", …, "number 1"
  contrastWords: string[];         // vi "nhưng", "thực ra", "sự thật là", "tuy nhiên"; en "but", "actually", "in fact", "however"
  quoteMarks: [string, string][];  // vi/en: ["“","”"], ["\"","\""]
};
export function getLangPack(code: string | null | undefined): ComposeLangPack;
```
- Files: `lang/types.ts`, `lang/vi.ts`, `lang/en.ts`, `lang/index.ts`.
- `getLangPack` matches the base code (`vi-VN` → `vi`, `EN` → `en`). An unknown or empty code returns `DIGITS_ONLY`: `decimalSep "."`, `thousandSep ","`, and every word list empty.
- Matching is case-insensitive and ignores Vietnamese tone marks only where the word list says so. Keep the lists as data, so a new language is one new file plus one line in `index.ts`.

## 2. Number parser — `packages/shared/src/compose/numbers.ts`

Input is the scene's word tokens, so word indexes line up with `SceneWord.i` and `KindSpan.wordStart`/`wordEnd` (end is exclusive, as in the baseline director).

```ts
export type NumberUnit = "percent" | "times" | "year" | "count" | `cur:${string}` | `word:${string}`;
export type NumberMention = {
  value: number;          // 1.5 triệu → 1500000; 20% → 20; năm 2020 → 2020
  unit: NumberUnit;       // "word:người" when a noun follows a count, "cur:usd" for $ / đô / USD, "cur:vnd" for đ / đồng / VND
  raw: string;            // the exact words joined by one space
  wordStart: number;
  wordEnd: number;        // exclusive
};
export function parseNumbers(words: string[], lang: ComposeLangPack): NumberMention[];

export type NumberGroup = {
  kind: "series" | "shares" | "same_unit";
  chart: "line" | "pie" | "bar";  // series → line, shares → pie, same_unit → bar
  unit: NumberUnit;
  items: { value: number; mentionIndex: number; year: number | null }[];
  wordStart: number;      // first word of the first item
  wordEnd: number;        // end of the last item
};
export function comparableGroups(mentions: NumberMention[]): NumberGroup[];
```

**Parser rules:**
- Separators come from the pack: `1.500` is 1500 in `vi` and 1.5 in `en`; `1,5` is 1.5 in `vi`. A group like `1.500.000` is always thousands. Trailing punctuation (`,` `.` `!` `?` `;` `:` `)`) on a token is stripped first.
- A scale word or suffix multiplies the number before it (`1,5 triệu`, `2 tỷ`, `3k`, `1.5 million`, `2bn`).
- `%`, `20 phần trăm`, `20 percent` → unit `percent`. `gấp 3 lần`, `3 times`, `3x` → `times`.
- A 4-digit integer 1900–2100 after a year marker, or alone and not followed by a scale word or noun-like unit, → `year`.
- A currency symbol or word next to the number → `cur:*`. Otherwise, a number followed by one plain word → `word:<that word lowercased>`; else `count`.
- Number words written out ("hai mươi", "twenty") are **out of scope**: skip them, and list it in the report.

**Grouping rules** (only ≥ 2 items make a group; mentions in one group must be in one scene's word list and in order):
- `series`: ≥ 2 years, each paired with a non-year value in the same clause (between sentence-end tokens), and the years increase. Item `year` is set. Unit = the value unit.
- `shares`: ≥ 2 `percent` values whose sum is within 100 ± 5.
- `same_unit`: ≥ 2 values with the same unit, other than `year`. Percentages that are not shares are `same_unit`.
- A mention belongs to at most one group. Priority: series, then shares, then same_unit.
- Labels are **not** made here. Fable picks them in the director; it skips R1 when the labels are unclear.

**Also export** (small, pure):
- `startsWithOrdinal(words: string[], lang): boolean`: the first 1–3 words, lowercased with trailing punctuation removed, match a pack ordinal, or the first token is `1.` / `2)` style for every language.
- `findContrastWord(words: string[], lang): { word: string; index: number } | null`.

## 3. Variety pass — `packages/shared/src/compose/variety.ts`

```ts
export type VarietyScene = {
  words: { text: string; startSec: number; endSec: number }[];
  spans: KindSpan[];      // in word order, covering the scene
  hasFootage: boolean;    // the director has footage hits for this scene
  hasStill: boolean;
};
export type VarietyChange = { scene: number; span: number; from: ShotKind; to: ShotKind; rule: "V1-run" | "V2-still" | "V3-graphic" | "V4-subtitle"; };
export function checkVariety(scenes: VarietyScene[]): { rule: VarietyChange["rule"]; scene: number; span: number }[];
export function enforceVariety(scenes: VarietyScene[]): { scenes: VarietyScene[]; changes: VarietyChange[] };
```

Span time = `words[wordStart].startSec` → `words[wordEnd - 1].endSec`. Runtime = the sum over all spans.

**Constraints** (`checkVariety` reports each violation; `enforceVariety` fixes them in this order and returns a plan with no violations when a fix exists):
- **V3-graphic:** `kinetic_text` + `chart` time ≤ 30 % of runtime. Fix: convert the shortest graphic spans first, keeping `R2-hook` (the hook) and charts last.
- **V4-subtitle:** a `kinetic_text` span longer than 3 s whose `payload.lines` text is the same as the words spoken in it (lowercased, punctuation removed, ≥ 80 % token overlap). Fix: move `wordEnd` back so the span is ≤ 3 s; if that leaves < 1 word, convert it.
- **V2-still:** when `hasFootage` is true for ≥ 50 % of scenes, `still` time ≤ 40 % of runtime. Fix: convert the longest `still` spans in scenes with `hasFootage` to `footage`.
- **V1-run:** no more than 2 spans of the same kind in a row, counted across scene edges. Fix: change the third span of a run to the best other kind for its scene (`footage` if `hasFootage`, else `still` if `hasStill`, else leave it and report it).
- **Converting** a span means: set the new kind, drop `payload`, keep the word range, and set `reason` to `<old reason>+<rule id>`.
- Never convert a span into `kinetic_text` or `chart` (those need content the director makes). Never change the number of spans except through V4 shortening (no merging, no splitting).
- Fixes must not create a new violation of an earlier rule. Run the four fixes, then run `checkVariety` again; loop at most 3 times; return whatever remains in a final check (Fable logs it as a warning).

## 4. Tests

In `packages/shared/src/compose/{lang,numbers,variety}.test.ts`:
- **Packs:** `vi-VN`/`EN`/`fr`/`""` resolve as specified; `DIGITS_ONLY` has empty lists.
- **`vi` numbers (≥ 12 cases):** `1,5 triệu`, `1.500`, `1.500.000`, `20%`, `20 phần trăm`, `gấp 3 lần`, `năm 2020`, `2 tỷ đồng`, `3 nghìn người`, `5 ngàn`, `100 USD`, `1,5` with trailing comma, a year alone, a time series sentence with 3 years.
- **`en` numbers (≥ 6 cases):** `1.5 million`, `1,500`, `20 percent`, `3 times`, `in 2020`, `2 billion`, `$100`, `3k`.
- **Digits-only fallback (≥ 4 cases):** `fr` text with `20%`, `2020`, `1.5`, `1,500`; scale words are not recognized.
- **Groups:** series → line; shares near 100 → pie; shares far from 100 → bar; one mention only → no group; a mention never in two groups; mixed units → no group.
- **Ordinals and contrast:** `Thứ nhất,` / `Số 1` / `1.` / `First,` / `Number 1` start; mid-sentence ordinal does not count; `nhưng` / `thực ra` / `but` / `in fact`.
- **Variety:** one test per rule V1–V4 for `checkVariety` and for `enforceVariety`; the order of fixes; no new violation; a scene with no footage and no still keeps a run and reports it; spans count unchanged; determinism (run twice, deep equal).
- Run `npx vitest run packages/shared/src/compose`, then `npm test` and `npm run typecheck` once at the end.

## 5. Docs

- Add one short paragraph to `docs/compose/README.md` (module map): `lang/`, `numbers.ts`, `variety.ts`, what each exports.
- No user guide page: this has no UI. In the report, say so.

## Done checklist

- [ ] Exports added to `packages/shared/src/compose/index.ts`; the shared package builds.
- [ ] All tests in §4 pass; full `npm test` and `npm run typecheck` pass (or list failures outside your files).
- [ ] No file outside §0 changed (`git status` checked).
- [ ] `docs/tasks/TASK-067c.report.md` (≤ 40 lines: files, test counts, cases skipped, open-source used, issues) and an empty `docs/tasks/TASK-067c.done`.
