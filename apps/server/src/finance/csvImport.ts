import {
  FinanceCsvPreviewResponseSchema,
  RevenueKindSchema,
  type FinanceCsvColumnMap,
  type FinanceCsvPreviewBody,
  type FinanceCsvPreviewResponse,
  type FinanceCsvPreviewRow,
  type RevenueKind,
} from "@vg/shared";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "," || ch === ";" || ch === "\t") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function splitLines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cell(headers: string[], cells: string[], column: string | undefined): string {
  if (!column) return "";
  const idx = headers.findIndex((h) => h.toLowerCase() === column.toLowerCase());
  if (idx < 0) return "";
  return cells[idx] ?? "";
}

export function previewRevenueCsv(body: FinanceCsvPreviewBody): FinanceCsvPreviewResponse {
  const lines = splitLines(body.csv);
  if (lines.length < 2) {
    return FinanceCsvPreviewResponseSchema.parse({
      rows: [],
      errors: [{ rowNumber: 1, message: "CSV cần ít nhất một dòng tiêu đề và một dòng dữ liệu" }],
    });
  }

  const headers = parseCsvLine(lines[0]!);
  const mapping: FinanceCsvColumnMap = body.mapping;
  const defaults = body.defaults ?? {};
  const rows: FinanceCsvPreviewRow[] = [];
  const errors: Array<{ rowNumber: number; message: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1;
    const cells = parseCsvLine(lines[i]!);
    const periodStart = cell(headers, cells, mapping.periodStart);
    const periodEndRaw = cell(headers, cells, mapping.periodEnd);
    const periodEnd = periodEndRaw || periodStart;
    const amountRaw = cell(headers, cells, mapping.amount);
    const currencyRaw = cell(headers, cells, mapping.currency) || defaults.currency || "VND";
    const kindRaw = cell(headers, cells, mapping.kind) || defaults.kind || "other";
    const noteRaw = cell(headers, cells, mapping.note);
    const accountRaw = cell(headers, cells, mapping.accountId) || defaults.accountId || "";
    const publicationRaw = cell(headers, cells, mapping.publicationId) || "";

    const rowErrors: string[] = [];
    if (!DATE_RE.test(periodStart)) rowErrors.push(`periodStart không hợp lệ: ${periodStart || "(trống)"}`);
    if (!DATE_RE.test(periodEnd)) rowErrors.push(`periodEnd không hợp lệ: ${periodEnd || "(trống)"}`);
    if (DATE_RE.test(periodStart) && DATE_RE.test(periodEnd) && periodEnd < periodStart) {
      rowErrors.push("periodEnd phải ≥ periodStart");
    }
    const amount = parseAmount(amountRaw);
    if (amount == null) rowErrors.push(`amount không hợp lệ: ${amountRaw || "(trống)"}`);

    const kindParsed = RevenueKindSchema.safeParse(kindRaw.trim().toLowerCase());
    if (!kindParsed.success) rowErrors.push(`kind không hợp lệ: ${kindRaw}`);

    if (rowErrors.length > 0) {
      for (const message of rowErrors) errors.push({ rowNumber, message });
      continue;
    }

    rows.push({
      rowNumber,
      periodStart,
      periodEnd,
      amount: amount!,
      currency: currencyRaw.trim().toUpperCase() || "VND",
      kind: kindParsed.data as RevenueKind,
      note: noteRaw ? noteRaw : null,
      accountId: accountRaw && /^[0-9a-f-]{36}$/i.test(accountRaw) ? accountRaw : (defaults.accountId ?? null),
      publicationId: publicationRaw && /^[0-9a-f-]{36}$/i.test(publicationRaw) ? publicationRaw : null,
      profileId: defaults.profileId ?? null,
    });
  }

  // Reject the whole file when any row is bad.
  if (errors.length > 0) {
    return FinanceCsvPreviewResponseSchema.parse({ rows: [], errors });
  }
  return FinanceCsvPreviewResponseSchema.parse({ rows, errors: [] });
}
