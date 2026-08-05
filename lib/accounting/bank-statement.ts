import { createHash } from "node:crypto";

export type ParsedBankLine = {
  transactionDate: string;
  valueDate: string | null;
  description: string;
  referenceNumber: string | null;
  amount: number;
  externalHash: string;
};

function parseCsvRow(row: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value.trim());
  return values;
}

function normalizedHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumn(headers: string[], candidates: string[]) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => header === candidate || header.includes(candidate)),
  );
}

function parseAmount(value: string | undefined) {
  if (!value) return 0;
  const negative = /^\s*\(.*\)\s*$/.test(value) || /\bdr\b/i.test(value);
  const numeric = Number(
    value
      .replace(/[(),]/g, "")
      .replace(/\b(?:cr|dr|myr|rm)\b/gi, "")
      .replace(/[^0-9.-]/g, ""),
  );
  if (!Number.isFinite(numeric)) return 0;
  return negative ? -Math.abs(numeric) : numeric;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const clean = value.trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/, "");
  const iso = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const dayFirst = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  let year: number;
  let month: number;
  let day: number;

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dayFirst) {
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    year = Number(dayFirst[3]);
    if (year < 100) year += 2000;
  } else {
    const parsed = new Date(clean);
    if (Number.isNaN(parsed.getTime())) return null;
    year = parsed.getFullYear();
    month = parsed.getMonth() + 1;
    day = parsed.getDate();
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseBankStatementCsv(content: string): ParsedBankLine[] {
  const rows = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  const parsedRows = rows.map(parseCsvRow);
  const headerIndex = parsedRows.findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return (
      findColumn(headers, ["transaction date", "posting date", "date"]) >= 0 &&
      (
        findColumn(headers, ["amount"]) >= 0 ||
        findColumn(headers, ["debit", "withdrawal"]) >= 0 ||
        findColumn(headers, ["credit", "deposit"]) >= 0
      )
    );
  });

  if (headerIndex < 0) {
    throw new Error("statement_header_not_found");
  }

  const headers = parsedRows[headerIndex].map(normalizedHeader);
  const dateIndex = findColumn(headers, ["transaction date", "posting date", "date"]);
  const valueDateIndex = findColumn(headers, ["value date"]);
  const descriptionIndex = findColumn(headers, ["transaction description", "description", "details", "narrative"]);
  const referenceIndex = findColumn(headers, ["reference number", "reference", "ref no", "cheque no"]);
  const debitIndex = findColumn(headers, ["debit amount", "withdrawal", "debit"]);
  const creditIndex = findColumn(headers, ["credit amount", "deposit", "credit"]);
  const amountIndex = findColumn(headers, ["transaction amount", "amount"]);
  const typeIndex = findColumn(headers, ["transaction type", "type", "dr cr"]);

  return parsedRows
    .slice(headerIndex + 1)
    .map((row, rowIndex) => {
      const transactionDate = parseDate(row[dateIndex]);
      if (!transactionDate) return null;

      let amount = 0;
      if (debitIndex >= 0 || creditIndex >= 0) {
        const debit = debitIndex >= 0 ? Math.abs(parseAmount(row[debitIndex])) : 0;
        const credit = creditIndex >= 0 ? Math.abs(parseAmount(row[creditIndex])) : 0;
        amount = credit - debit;
      } else if (amountIndex >= 0) {
        amount = parseAmount(row[amountIndex]);
        const type = typeIndex >= 0 ? row[typeIndex]?.toLowerCase() ?? "" : "";
        if (/debit|withdraw|money out|\bdr\b/.test(type)) amount = -Math.abs(amount);
        if (/credit|deposit|money in|\bcr\b/.test(type)) amount = Math.abs(amount);
      }

      if (Math.abs(amount) < 0.005) return null;
      const description = row[descriptionIndex] || "Bank transaction";
      const referenceNumber = row[referenceIndex] || null;
      const valueDate = valueDateIndex >= 0 ? parseDate(row[valueDateIndex]) : null;
      const rawKey = [transactionDate, valueDate, amount.toFixed(2), description, referenceNumber, rowIndex].join("|");

      return {
        transactionDate,
        valueDate,
        description,
        referenceNumber,
        amount: Number(amount.toFixed(2)),
        externalHash: createHash("sha256").update(rawKey).digest("hex"),
      } satisfies ParsedBankLine;
    })
    .filter((line): line is ParsedBankLine => Boolean(line));
}
