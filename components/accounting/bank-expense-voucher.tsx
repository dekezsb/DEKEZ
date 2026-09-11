"use client";

import { useState } from "react";
import { createBankExpenseVoucher } from "@/app/reports/actions";
import { ReconciliationSubmitButton } from "./reconciliation-submit-button";

type Row = { id: number; propertyId: string; accountId: string; description: string; amount: string };
type Account = {
  id: string;
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "income" | "expense";
};

const accountTypeLabels: Record<Account["accountType"], string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

export function BankExpenseVoucher({ lineId, amount, properties, accounts }: {
  lineId: string; amount: number; properties: { id: string; name: string }[]; accounts: Account[];
}) {
  const blank = (id: number): Row => ({ id, propertyId: "", accountId: "", description: "", amount: "" });
  const [rows, setRows] = useState<Row[]>([blank(1)]);
  const [nextId, setNextId] = useState(2);
  const update = (id: number, key: keyof Row, value: string) => setRows((items) => items.map((row) => row.id === id ? { ...row, [key]: value } : row));
  const cents = rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.amount)) ? Math.round(Number(row.amount) * 100) : 0), 0);
  const difference = Math.round(amount * 100) - cents;
  const field = "h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm";
  const valid = rows.every((r) => r.propertyId && r.accountId && r.description.trim() && /^\d+(\.\d{1,2})?$/.test(r.amount) && Number(r.amount) > 0);
  const accountGroups = (Object.keys(accountTypeLabels) as Account["accountType"][])
    .map((accountType) => ({
      accountType,
      accounts: accounts.filter((account) => account.accountType === accountType),
    }))
    .filter((group) => group.accounts.length);
  return <details className="rounded-lg border-2 border-blue-300 bg-blue-50" open>
    <summary className="cursor-pointer p-4 font-semibold text-blue-950">New payment voucher · allocate by account</summary>
    <form action={createBankExpenseVoucher} className="space-y-4 border-t border-blue-200 p-4">
      <p className="text-sm text-blue-900">Choose any active chart of account for each line, including assets, liabilities, equity, income or expenses. If a bill already exists, use receipt matching to avoid recording it twice.</p>
      <input type="hidden" name="lineId" value={lineId} /><input type="hidden" name="bankFlow" value="debit" />
      <input type="hidden" name="voucherLines" value={JSON.stringify(rows)} />
      <label className="block text-sm font-medium">Paid to / supplier<input className={field} name="payee" maxLength={160} placeholder="e.g. Sabah Electricity" required /></label>
      {rows.map((row, index) => <fieldset key={row.id} className="grid gap-3 rounded-md border border-blue-200 bg-white p-3 md:grid-cols-2 xl:grid-cols-4">
        <legend className="px-1 text-sm font-semibold">Line {index + 1}</legend>
        <label className="text-xs">Property / outlet<select className={field} value={row.propertyId} onChange={(e) => update(row.id, "propertyId", e.target.value)} required><option value="">Choose property</option><option value="office">Office use / general company</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-xs">Chart of account<select className={field} value={row.accountId} onChange={(e) => update(row.id, "accountId", e.target.value)} required><option value="">Choose account</option>{accountGroups.map((group) => <optgroup key={group.accountType} label={accountTypeLabels[group.accountType]}>{group.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</optgroup>)}</select></label>
        <label className="text-xs">Description / bill reference<input className={field} value={row.description} onChange={(e) => update(row.id, "description", e.target.value)} maxLength={300} required /></label>
        <label className="text-xs">Amount (RM)<input className={field} type="number" step="0.01" min="0.01" value={row.amount} onChange={(e) => update(row.id, "amount", e.target.value)} required /></label>
        <button className="text-left text-xs text-red-700 disabled:text-gray-400" type="button" disabled={rows.length === 1} onClick={() => setRows((items) => items.filter((r) => r.id !== row.id))}>Remove line {index + 1}</button>
      </fieldset>)}
      <button type="button" className="rounded-md border border-blue-400 bg-white px-4 py-2 text-sm font-semibold" disabled={rows.length >= 50} onClick={() => { setRows((items) => [...items, blank(nextId)]); setNextId(nextId + 1); }}>+ Add line</button>
      <div className="flex flex-wrap gap-6 rounded-md bg-white p-3 text-sm"><span>Bank payment: <strong>RM {amount.toFixed(2)}</strong></span><span>Voucher total: <strong>RM {(cents / 100).toFixed(2)}</strong></span><span className={difference ? "text-red-700" : "text-emerald-700"}>Difference: <strong>RM {(difference / 100).toFixed(2)}</strong></span></div>
      <label className="flex gap-2 text-sm"><input type="checkbox" name="confirmed" value="1" required />I have checked every line and selected the correct chart of account. Any related bill has not already been recorded.</label>
      <ReconciliationSubmitButton disabled={!valid || difference !== 0} pendingLabel="Saving voucher and reconciling...">Save voucher &amp; reconcile</ReconciliationSubmitButton>
    </form>
  </details>;
}
