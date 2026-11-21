export function normalizeQuery(query: string): string {
  return query.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function attentionLabel(reason: string | null | undefined): string | null {
  switch (reason) {
    case "lowRelevance": return "ảnh lệch chủ đề";
    case "vision_reject": return "AI nhìn loại ảnh";
    case "vision_missing": return "chưa có kết quả AI nhìn";
    case "invalid_source": return "ảnh nguồn không dùng được";
    case "no_candidate": return "không có ảnh đúng";
    case "source_risk": return "nguồn rủi ro cao";
    default: return null;
  }
}

export function stripQueryModifiers(query: string): string {
  return query.replace(/\b(?:close[- ]?up|wide shot|archival photo|detail|portrait|illustration)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function simplifyQuery(query: string): string {
  const genericWords = new Set([
    "match", "game", "move", "final", "photo", "image", "close", "up", "exterior",
    "analysis", "press", "conference", "scene", "view", "shot",
  ]);
  const terms = stripQueryModifiers(query).split(/\s+/)
    .filter((term) => !/^\d+$/.test(term) && !genericWords.has(term.toLocaleLowerCase()));
  return terms.length >= 2 ? terms.join(" ") : "";
}

export function properNounQueries(queries: string[]): string[] {
  const properNames = queries.flatMap((query) => {
    const tokens = stripQueryModifiers(query).match(/[\p{L}\p{N}]+/gu) ?? [];
    return tokens.filter((token) => token.length > 1
      && /^(?:\p{Lu}[\p{L}\p{N}]*|[\p{Ll}\p{N}]*\p{Lu}[\p{L}\p{N}]*)$/u.test(token)
      && /\p{Lu}/u.test(token));
  });
  const uniqueNames = [...new Map(properNames.map((name) => [normalizeQuery(name), name])).values()];
  const queriesToTry = uniqueNames.length > 1 ? [uniqueNames.slice(0, 3).join(" ")] : [];
  queriesToTry.push(...uniqueNames);
  return [...new Set(queriesToTry)];
}
