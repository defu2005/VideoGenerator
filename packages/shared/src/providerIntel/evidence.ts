import type { Evidenced, EvidenceSource } from "../schemas/providerIntel.js";

export function unknownEvidence<T = string>(source: EvidenceSource = "public_docs"): Evidenced<T> {
  return { value: "UNKNOWN", source };
}

export function knownEvidence<T>(
  value: T,
  sourceUrl: string,
  verifiedAt: string,
  source: EvidenceSource = "public_docs",
  quote?: string,
): Evidenced<T> {
  return {
    value,
    sourceUrl,
    verifiedAt,
    source,
    ...(quote ? { quote } : {}),
  };
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function quoteWordCount(quote: string): number {
  return normalizeWhitespace(quote).split(" ").filter(Boolean).length;
}

/** A supporting quote is at most 25 words and must occur in the page after whitespace is folded. */
export function quoteInPage(pageText: string, quote: string): boolean {
  const words = quoteWordCount(quote);
  if (words < 1 || words > 25) return false;
  return normalizeWhitespace(pageText).includes(normalizeWhitespace(quote));
}

export type ExtractField = { path: string; value: string; quote: string };

export function acceptExtractedFields(pageText: string, fields: ExtractField[]): {
  accepted: ExtractField[];
  rejected: ExtractField[];
} {
  const accepted: ExtractField[] = [];
  const rejected: ExtractField[] = [];
  for (const field of fields) {
    if (quoteInPage(pageText, field.quote)) accepted.push(field);
    else rejected.push(field);
  }
  return { accepted, rejected };
}

export function getPath(root: unknown, path: string): unknown {
  let cursor = root;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

export function isUserChecked(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { source?: string }).source === "user_checked");
}

const EVIDENCE_KEYS = new Set(["value", "source", "sourceUrl", "quote", "verifiedAt"]);

/** Every non-UNKNOWN evidenced object must carry a URL and a date. */
export function missingEvidence(value: unknown, path = "", issues: string[] = []): string[] {
  if (!value || typeof value !== "object") return issues;
  if (Array.isArray(value)) {
    value.forEach((item, index) => missingEvidence(item, `${path}[${index}]`, issues));
    return issues;
  }
  const record = value as Record<string, unknown>;
  if ("value" in record && "source" in record && record.value !== "UNKNOWN") {
    if (typeof record.sourceUrl !== "string" || record.sourceUrl.length === 0) issues.push(`${path}.sourceUrl`);
    if (typeof record.verifiedAt !== "string" || record.verifiedAt.length === 0) issues.push(`${path}.verifiedAt`);
  }
  for (const [key, child] of Object.entries(record)) {
    if (EVIDENCE_KEYS.has(key)) continue;
    missingEvidence(child, path ? `${path}.${key}` : key, issues);
  }
  return issues;
}
