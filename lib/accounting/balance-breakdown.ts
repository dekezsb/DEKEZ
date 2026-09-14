export type BalanceSectionName = "Assets" | "Liabilities" | "Equity";
export type BalanceDetail = {
  id: string; date: string; reference: string; description: string;
  propertyId: string | null; propertyName: string; amount: number; source: string;
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

export function balanceComparison(current: BalanceSnapshot, prior: BalanceSnapshot) {
  const priorByKey = new Map(prior.rows.map((row) => [row.key, row]));
  const currentByKey = new Map(current.rows.map((row) => [row.key, row]));
  return [...new Set([...currentByKey.keys(), ...priorByKey.keys()])].map((key) => {
    const now = currentByKey.get(key);
    const before = priorByKey.get(key);
    return {...(now ?? before)!, amount: now?.amount ?? 0, details: now?.details ?? [], priorAmount: before?.amount ?? 0, priorDetails: before?.details ?? [], change: Math.round(((now?.amount ?? 0) - (before?.amount ?? 0)) * 100) / 100};
  });
}
