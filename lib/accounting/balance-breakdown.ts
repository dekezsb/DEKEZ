export type BalanceSectionName = "Assets" | "Liabilities" | "Equity";
export type BalanceDetail = {
  id: string; date: string; reference: string; description: string;
  propertyId: string | null; propertyName: string; amount: number; source: string;
  sourceHref?: string;
};
export type BalanceRow = {
  key: string; code: string; label: string; section: BalanceSectionName;
  amount: number; details: BalanceDetail[];
};
export type BalanceBasisLine = BalanceDetail & {
  key: string; code: string; label: string; section: BalanceSectionName;
  shared?: boolean;
};
export function balanceSnapshot(date: string, definitions: Omit<BalanceRow, "amount" | "details">[], lines: BalanceBasisLine[], propertyId = "") {
  const rows = new Map<string, BalanceRow>(definitions.map((row) => [row.key, {...row, amount: 0, details: []}]));
  for (const line of lines) {
    if (line.date > date || (propertyId && !line.shared && line.propertyId !== propertyId)) continue;
    const row = rows.get(line.key) ?? {key: line.key, code: line.code, label: line.label, section: line.section, amount: 0, details: []};
    row.details.push({...line, amount: Math.round(line.amount * 100) / 100});
    rows.set(line.key, row);
  }
  for (const row of rows.values()) {
    row.details.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    row.amount = row.details.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100;
  }
  return {date, rows: [...rows.values()].sort((a, b) => a.code.localeCompare(b.code))};
}
export type BalanceSnapshot = ReturnType<typeof balanceSnapshot>;

export function accountLedger(details: BalanceDetail[], section: BalanceSectionName, from: string, to: string) {
  const ordered = [...details].filter((line) => line.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const isOpening = (line: BalanceDetail) => line.date < from || (line.date === from && line.description === "Statement opening balance");
  const openingCents = ordered.filter(isOpening).reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
  let balanceCents = openingCents;
  const rows = ordered.filter((line) => !isOpening(line)).map((line) => {
    const cents = Math.round(line.amount * 100);
    balanceCents += cents;
    const kind = line.source === "Posted journal" || line.source === "Bank voucher / adjustment offset" ? "Posted entry"
      : line.source === "Deposit payment" ? "Confirmed receipt"
      : line.source.startsWith("Bank statement ending") ? "Bank movement"
      : "Balance support — not a posting";
    const signedDebit = section === "Assets" ? cents : -cents;
    const posting = kind !== "Balance support — not a posting";
    return {...line, kind, debit: posting ? Math.max(signedDebit, 0) / 100 : null, credit: posting ? Math.max(-signedDebit, 0) / 100 : null, runningBalance: balanceCents / 100};
  });
  return {opening: openingCents / 100, closing: balanceCents / 100, rows,
    debit: rows.reduce((sum, row) => sum + Math.round((row.debit ?? 0) * 100), 0) / 100,
    credit: rows.reduce((sum, row) => sum + Math.round((row.credit ?? 0) * 100), 0) / 100,
    balanceSupport: rows.filter((row) => row.debit === null).reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100};
}

export function balanceComparison(current: BalanceSnapshot, prior: BalanceSnapshot) {
  const priorByKey = new Map(prior.rows.map((row) => [row.key, row]));
  const currentByKey = new Map(current.rows.map((row) => [row.key, row]));
  return [...new Set([...currentByKey.keys(), ...priorByKey.keys()])].map((key) => {
    const now = currentByKey.get(key);
    const before = priorByKey.get(key);
    return {...(now ?? before)!, amount: now?.amount ?? 0, details: now?.details ?? [], priorAmount: before?.amount ?? 0, priorDetails: before?.details ?? [], change: Math.round(((now?.amount ?? 0) - (before?.amount ?? 0)) * 100) / 100};
  });
}
