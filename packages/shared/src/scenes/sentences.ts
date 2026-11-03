const ABBREVIATIONS = ["Mr.", "Dr.", "St.", "vs.", "v.v.", "e.g.", "i.e.", "U.S."] as const;

function isAbbreviationPeriod(text: string, index: number): boolean {
  const before = text.slice(0, index + 1);
  const after = text.slice(index + 1);

  if (/\bTP\.$/i.test(before) && /^\s*HCM\b/i.test(after)) return true;
  if (/\b(?:TP\.HCM|U\.S|v\.v|e\.g|i\.e)\.$/i.test(before)) {
    return /^[\p{L}]/u.test(after.trimStart());
  }
  if (/\b(?:Mr|Dr|St)\.$/i.test(before)) {
    return /^\s*\p{Lu}\p{L}/u.test(after);
  }
  if (ABBREVIATIONS.some((abbreviation) => before.toLowerCase().endsWith(abbreviation.toLowerCase()))) {
    const next = after.trimStart();
    return next.length > 0 && /^\p{Ll}/u.test(next);
  }

  const initial = before.match(/(?:^|\s)(\p{Lu})\.$/u);
  return initial !== null && /^\s*\p{Lu}\p{L}/u.test(after);
}

function insideQuotedLowercaseEllipsis(text: string, start: number, end: number): boolean {
  const quoteStack: string[] = [];
  for (const quote of text.slice(0, start).matchAll(/["“”‘’]/gu)) {
    if (quote[0] === "\"") {
      if (quoteStack.at(-1) === "\"") quoteStack.pop();
      else quoteStack.push("\"");
    } else if (quote[0] === "“" || quote[0] === "‘") {
      quoteStack.push(quote[0]);
    } else if (quote[0] === "”" && quoteStack.at(-1) === "“") {
      quoteStack.pop();
    } else if (quote[0] === "’" && quoteStack.at(-1) === "‘") {
      quoteStack.pop();
    }
  }
  if (quoteStack.length === 0) return false;
  const following = text.slice(end).replace(/^\s*["”’]+/u, "");
  return /^\s*\p{Ll}/u.test(following);
}

export function splitSentences(text: string, _language: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const sentences: string[] = [];
  let start = 0;
  let index = 0;

  const push = (end: number) => {
    const sentence = normalized.slice(start, end).replace(/\s+/gu, " ").trim();
    if (sentence) sentences.push(sentence);
    start = end;
  };

  while (index < normalized.length) {
    const char = normalized[index];
    if (char === "\n") {
      push(index);
      index += 1;
      while (normalized[index] === "\n") index += 1;
      start = index;
      continue;
    }

    if (char === "." && isAbbreviationPeriod(normalized, index)) {
      index += 1;
      continue;
    }
    if (char !== "." && char !== "!" && char !== "?" && char !== "…") {
      index += 1;
      continue;
    }

    const punctuationStart = index;
    while (normalized[index] === "." || normalized[index] === "!" || normalized[index] === "?" || normalized[index] === "…") {
      index += 1;
    }
    const punctuation = normalized.slice(punctuationStart, index);
    if ((punctuation.includes("…") || punctuation === "...")
      && insideQuotedLowercaseEllipsis(normalized, punctuationStart, index)) continue;
    let boundaryEnd = index;
    while (normalized[boundaryEnd] === "\"" || normalized[boundaryEnd] === "”" || normalized[boundaryEnd] === "’") {
      boundaryEnd += 1;
    }
    if (boundaryEnd < normalized.length && !/\s/u.test(normalized[boundaryEnd])) {
      index = boundaryEnd;
      continue;
    }
    push(boundaryEnd);
    index = boundaryEnd;
    while (index < normalized.length && /\s/u.test(normalized[index])) index += 1;
    start = index;
  }

  push(normalized.length);
  return sentences;
}
