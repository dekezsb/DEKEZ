"use client";

import { useMemo, useState } from "react";
import { PlusCircle, Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { amendVoucher, postVoucher } from "@/app/reports/voucher-actions";
import { Button } from "@/components/ui/button";
import { voucherLinesPayload, voucherTypeLabels, type VoucherFormLine, type VoucherType } from "@/lib/accounting/vouchers";

export type VoucherAccount = { id: string; code: string; name: string; accountType: string };
type Line = VoucherFormLine & { clientId: number };

const currency = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2 });
const typeGroups: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
const input = "mt-1 h-10 w-full rounded-md border border-[#d7dde5] bg-white px-3 text-sm";

export function VoucherForm({
  mode, kind = "voucher", id = "", type, accounts, paymentAccounts, properties, initial, lockedTotal = 0, bankAccountName,
}: {
  mode: "new" | "edit";
  kind?: "voucher" | "journal" | "bank";
  id?: string;
  type: VoucherType;
  accounts: VoucherAccount[];
  paymentAccounts: VoucherAccount[];
  properties: { id: string; name: string }[];
  initial: { date: string; party: string; propertyId: string; paymentAccountId: string; reference: string; description: string; lines: VoucherFormLine[] };
  lockedTotal?: number;
  bankAccountName?: string;
}) {
  const isBank = kind === "bank";
  const isJournal = type === "JV";
  const blank = (clientId: number): Line => ({ clientId, accountId: "", propertyId: isBank ? "office" : "", description: "", amount: "", debit: "", credit: "" });
  const [lines, setLines] = useState<Line[]>(() => {
    const seeded = initial.lines.map((line, index) => ({ ...blank(index + 1), ...line, clientId: index + 1 }));
    while (seeded.length < (isJournal ? 2 : 1)) seeded.push(blank(seeded.length + 1));
    return seeded;
  });
  const [paymentAccountId, setPaymentAccountId] = useState(initial.paymentAccountId);
  const grouped = useMemo(() => {
    const groups = new Map<string, VoucherAccount[]>();
    for (const account of accounts) groups.set(account.accountType, [...(groups.get(account.accountType) ?? []), account]);
    return Array.from(groups.entries());
  }, [accounts]);
  const check = voucherLinesPayload(type, lines);
  const totals = lines.reduce((sum, line) => ({
    debit: sum.debit + (Number(isJournal ? line.debit : line.amount) || 0),
    credit: sum.credit + (Number(isJournal ? line.credit : 0) || 0),
  }), { debit: 0, credit: 0 });
  const totalCents = Math.round(totals.debit * 100);
  const totalOk = !isBank || totalCents === Math.round(lockedTotal * 100);
  const valid = !("error" in check) && totalOk && (isJournal || isBank || Boolean(paymentAccountId));
  const update = (clientId: number, field: keyof VoucherFormLine, value: string) => setLines((current) => current.map((line) => {
    if (line.clientId !== clientId) return line;
    if (field === "debit" && Number(value) > 0) return { ...line, debit: value, credit: "" };
    if (field === "credit" && Number(value) > 0) return { ...line, credit: value, debit: "" };
    return { ...line, [field]: value };
  }));
  const linesJson = JSON.stringify(lines.map(({ clientId: _clientId, ...line }) => line));
  const partyLabel = type === "RV" ? "Received from (payer)" : "Paid to (payee)";
  const columns = isJournal ? "grid-cols-[240px_180px_1fr_130px_130px_44px]" : "grid-cols-[260px_190px_1fr_140px_44px]";

  return (
    <form action={mode === "new" ? postVoucher : amendVoucher} className="space-y-5">
      <input name="voucherType" type="hidden" value={type} />
      <input name="kind" type="hidden" value={kind} />
      <input name="id" type="hidden" value={id} />
      <input name="linesJson" type="hidden" value={linesJson} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium text-gray-700">{voucherTypeLabels[type]} date
          <input className={input} defaultValue={initial.date} disabled={isBank} name="voucherDate" required type="date" />
          {isBank ? <span className="mt-1 block text-xs text-gray-500">Bank statement date (fixed)</span> : null}
        </label>
        {!isJournal ? (
          <label className="text-sm font-medium text-gray-700">{partyLabel}
            <input className={input} defaultValue={initial.party} maxLength={160} name="party" placeholder="Supplier, tenant or person" required />
          </label>
        ) : null}
        {!isJournal && !isBank ? (
          <label className="text-sm font-medium text-gray-700">{type === "RV" ? "Received into (cash / bank)" : "Paid from (cash / bank)"}
            <select className={input} name="paymentAccountId" onChange={(event) => setPaymentAccountId(event.target.value)} required value={paymentAccountId}>
              <option value="">Choose cash or bank account</option>
              {paymentAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </select>
          </label>
        ) : null}
        {isBank ? <div className="text-sm font-medium text-gray-700">Paid from<p className="mt-3 text-sm font-normal">{bankAccountName ?? "Company bank"} (matched bank line)</p></div> : null}
        {!isJournal && !isBank ? (
          <label className="text-sm font-medium text-gray-700">Property (optional)
            <select className={input} defaultValue={initial.propertyId} name="propertyId">
              <option value="">General company</option>
              {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
            </select>
          </label>
        ) : null}
        {!isBank ? (
          <label className="text-sm font-medium text-gray-700">{isJournal ? "Reference (optional)" : "Cheque / bank reference (optional)"}
            <input className={input} defaultValue={initial.reference} maxLength={100} name="reference" placeholder="Cheque no, transfer ref, bill no" />
          </label>
        ) : null}
        {!isBank ? (
          <label className="text-sm font-medium text-gray-700 md:col-span-2">Description
            <input className={input} defaultValue={initial.description} maxLength={500} name="description" placeholder="What this payment / receipt / journal is for" required />
          </label>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#d7dde5]">
        <div className="min-w-[900px]">
          <div className={`grid ${columns} gap-2 bg-gray-100 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600`}>
            <span>Account</span><span>Property</span><span>Line description</span>
            {isJournal ? <><span className="text-right">Debit</span><span className="text-right">Credit</span></> : <span className="text-right">Amount (RM)</span>}<span />
          </div>
          <div className="divide-y divide-[#e3e8ef]">
            {lines.map((line, index) => (
              <div className={`grid ${columns} gap-2 px-3 py-3`} key={line.clientId}>
                <select aria-label={`Account for line ${index + 1}`} className="h-10 rounded-md border border-[#d7dde5] bg-white px-2 text-sm" onChange={(event) => update(line.clientId, "accountId", event.target.value)} required value={line.accountId}>
                  <option value="">Choose account</option>
                  {grouped.map(([group, items]) => <optgroup key={group} label={typeGroups[group] ?? group}>{items.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</optgroup>)}
                </select>
                <select aria-label={`Property for line ${index + 1}`} className="h-10 rounded-md border border-[#d7dde5] bg-white px-2 text-sm" onChange={(event) => update(line.clientId, "propertyId", event.target.value)} value={line.propertyId}>
                  {isBank ? <option value="office">Office / general</option> : <option value="">General company</option>}
                  {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
                <input aria-label={`Description for line ${index + 1}`} className="h-10 rounded-md border border-[#d7dde5] px-2 text-sm" maxLength={300} onChange={(event) => update(line.clientId, "description", event.target.value)} placeholder="Line details" required={isBank} value={line.description} />
                {isJournal ? (
                  <>
                    <input aria-label={`Debit for line ${index + 1}`} className="h-10 rounded-md border border-[#d7dde5] px-2 text-right text-sm" min="0" onChange={(event) => update(line.clientId, "debit", event.target.value)} placeholder="0.00" step="0.01" type="number" value={line.debit ?? ""} />
                    <input aria-label={`Credit for line ${index + 1}`} className="h-10 rounded-md border border-[#d7dde5] px-2 text-right text-sm" min="0" onChange={(event) => update(line.clientId, "credit", event.target.value)} placeholder="0.00" step="0.01" type="number" value={line.credit ?? ""} />
                  </>
                ) : (
                  <input aria-label={`Amount for line ${index + 1}`} className="h-10 rounded-md border border-[#d7dde5] px-2 text-right text-sm" min="0" onChange={(event) => update(line.clientId, "amount", event.target.value)} placeholder="0.00" step="0.01" type="number" value={line.amount ?? ""} />
                )}
                <Button aria-label={`Remove line ${index + 1}`} disabled={lines.length <= (isJournal ? 2 : 1)} onClick={() => setLines((current) => current.filter((item) => item.clientId !== line.clientId))} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4 text-red-600" /></Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-[#d7dde5] bg-gray-50 p-4 lg:flex-row lg:items-center lg:justify-between">
        <Button onClick={() => setLines((current) => [...current, blank(Math.max(0, ...current.map((line) => line.clientId)) + 1)])} type="button" variant="outline"><PlusCircle className="h-4 w-4" />Add line</Button>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          {isJournal ? (
            <>
              <div><span className="text-gray-600">Total debit</span><strong className="mt-1 block text-lg">{currency.format(totals.debit)}</strong></div>
              <div><span className="text-gray-600">Total credit</span><strong className="mt-1 block text-lg">{currency.format(totals.credit)}</strong></div>
              <div><span className="text-gray-600">Difference</span><strong className={`mt-1 block text-lg ${Math.abs(totals.debit - totals.credit) < 0.005 && totals.debit > 0 ? "text-emerald-700" : "text-red-600"}`}>{currency.format(totals.debit - totals.credit)}</strong></div>
            </>
          ) : (
            <>
              <div><span className="text-gray-600">Voucher total</span><strong className="mt-1 block text-lg">{currency.format(totals.debit)}</strong></div>
              {isBank ? <div><span className="text-gray-600">Bank amount</span><strong className={`mt-1 block text-lg ${totalOk ? "text-emerald-700" : "text-red-600"}`}>{currency.format(lockedTotal)}</strong></div> : null}
              <div className="text-xs text-gray-600 sm:col-span-1">{type === "PV" ? "Debits these accounts, credits the cash / bank account." : "Credits these accounts, debits the cash / bank account."}</div>
            </>
          )}
        </div>
      </div>

      {mode === "edit" ? (
        <label className="block text-sm font-medium text-gray-700">Reason for this change (kept in the audit trail)
          <input className={input} maxLength={500} minLength={5} name="reason" placeholder="e.g. Wrong account selected / supplier gave discount" required />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-600">{mode === "edit"
          ? "Saving keeps the same voucher number. The system automatically reverses the old entry and posts the corrected one, so the history stays complete for audit."
          : "A number like PV2611-001 is given automatically when you save."}</p>
        <SubmitButton disabled={!valid} label={mode === "edit" ? "Save changes" : `Save ${voucherTypeLabels[type]}`} />
      </div>
    </form>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return <Button disabled={disabled || pending} type="submit">{pending ? "Saving…" : label}</Button>;
}
