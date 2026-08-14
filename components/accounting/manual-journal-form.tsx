"use client";

import { useMemo, useState } from "react";
import { PlusCircle, Scale, Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { postManualJournalEntry } from "@/app/reports/actions";
import { Button } from "@/components/ui/button";

type JournalAccount = {
  id: string;
  code: string;
  name: string;
  accountType: string;
};

type JournalProperty = {
  id: string;
  name: string;
};

type JournalLine = {
  clientId: number;
  accountId: string;
  propertyId: string;
  description: string;
  debit: string;
  credit: string;
};

const currency = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 2,
});

const emptyLine = (clientId: number): JournalLine => ({
  clientId,
  accountId: "",
  propertyId: "",
  description: "",
  debit: "",
  credit: "",
});

export function ManualJournalForm({
  accounts,
  defaultEntryDate,
  properties,
}: {
  accounts: JournalAccount[];
  defaultEntryDate: string;
  properties: JournalProperty[];
}) {
  const [lines, setLines] = useState<JournalLine[]>([
    emptyLine(1),
    emptyLine(2),
  ]);
  const groupedAccounts = useMemo(() => {
    const groups = new Map<string, JournalAccount[]>();
    for (const account of accounts) {
      groups.set(account.accountType, [
        ...(groups.get(account.accountType) ?? []),
        account,
      ]);
    }
    return Array.from(groups.entries());
  }, [accounts]);
  const totals = useMemo(
    () => lines.reduce(
      (result, line) => ({
        debit: result.debit + (Number(line.debit) || 0),
        credit: result.credit + (Number(line.credit) || 0),
      }),
      { debit: 0, credit: 0 },
    ),
    [lines],
  );
  const difference = totals.debit - totals.credit;
  const validLines = lines.every((line) => {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    return line.accountId && ((debit > 0 && credit === 0) || (credit > 0 && debit === 0));
  });
  const balanced = totals.debit > 0 && Math.abs(difference) < 0.005;
  const linesJson = JSON.stringify(lines.map((line) => ({
    account_id: line.accountId,
    property_id: line.propertyId || null,
    description: line.description || null,
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0,
  })));

  function updateLine(clientId: number, field: keyof JournalLine, value: string) {
    setLines((current) => current.map((line) => {
      if (line.clientId !== clientId) return line;
      if (field === "debit" && Number(value) > 0) return { ...line, debit: value, credit: "" };
      if (field === "credit" && Number(value) > 0) return { ...line, debit: "", credit: value };
      return { ...line, [field]: value };
    }));
  }

  return (
    <form action={postManualJournalEntry} className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium text-gray-700">
          Entry date
          <input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" defaultValue={defaultEntryDate} name="entryDate" required type="date" />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Reference (optional)
          <input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" maxLength={100} name="referenceNumber" placeholder="Voucher, payroll or adjustment no." />
        </label>
        <label className="text-sm font-medium text-gray-700 md:col-span-1">
          Journal description
          <input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3" maxLength={500} name="description" placeholder="Why this journal is needed" required />
        </label>
      </div>

      <input name="linesJson" type="hidden" value={linesJson} />
      <div className="overflow-x-auto rounded-lg border border-[#d7dde5]">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[250px_190px_1fr_145px_145px_48px] gap-2 bg-gray-100 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
            <span>Account</span><span>Property</span><span>Line explanation</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
          </div>
          <div className="divide-y divide-[#e3e8ef]">
            {lines.map((line, index) => (
              <div className="grid grid-cols-[250px_190px_1fr_145px_145px_48px] gap-2 px-3 py-3" key={line.clientId}>
                <label className="sr-only" htmlFor={`journal-account-${line.clientId}`}>Account for journal line {index + 1}</label>
                <select className="h-10 rounded-md border border-[#d7dde5] bg-white px-2 text-sm" id={`journal-account-${line.clientId}`} onChange={(event) => updateLine(line.clientId, "accountId", event.target.value)} required value={line.accountId}>
                  <option value="">Choose account</option>
                  {groupedAccounts.map(([type, group]) => (
                    <optgroup key={type} label={type.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase())}>
                      {group.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`journal-property-${line.clientId}`}>Property for journal line {index + 1}</label>
                <select className="h-10 rounded-md border border-[#d7dde5] bg-white px-2 text-sm" id={`journal-property-${line.clientId}`} onChange={(event) => updateLine(line.clientId, "propertyId", event.target.value)} value={line.propertyId}>
                  <option value="">General company</option>
                  {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
                <label className="sr-only" htmlFor={`journal-description-${line.clientId}`}>Description for journal line {index + 1}</label>
                <input className="h-10 rounded-md border border-[#d7dde5] px-2 text-sm" id={`journal-description-${line.clientId}`} maxLength={300} onChange={(event) => updateLine(line.clientId, "description", event.target.value)} placeholder="Line details" value={line.description} />
                <label className="sr-only" htmlFor={`journal-debit-${line.clientId}`}>Debit for journal line {index + 1}</label>
                <input className="h-10 rounded-md border border-[#d7dde5] px-2 text-right text-sm" id={`journal-debit-${line.clientId}`} min="0" onChange={(event) => updateLine(line.clientId, "debit", event.target.value)} placeholder="0.00" step="0.01" type="number" value={line.debit} />
                <label className="sr-only" htmlFor={`journal-credit-${line.clientId}`}>Credit for journal line {index + 1}</label>
                <input className="h-10 rounded-md border border-[#d7dde5] px-2 text-right text-sm" id={`journal-credit-${line.clientId}`} min="0" onChange={(event) => updateLine(line.clientId, "credit", event.target.value)} placeholder="0.00" step="0.01" type="number" value={line.credit} />
                <Button aria-label={`Remove journal line ${index + 1}`} disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((item) => item.clientId !== line.clientId))} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4 text-red-600" /></Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-[#d7dde5] bg-gray-50 p-4 lg:flex-row lg:items-center lg:justify-between">
        <Button onClick={() => setLines((current) => [...current, emptyLine(Math.max(...current.map((line) => line.clientId)) + 1)])} type="button" variant="outline"><PlusCircle className="h-4 w-4" />Add journal line</Button>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div><span className="text-gray-600">Total debit</span><strong className="mt-1 block text-lg">{currency.format(totals.debit)}</strong></div>
          <div><span className="text-gray-600">Total credit</span><strong className="mt-1 block text-lg">{currency.format(totals.credit)}</strong></div>
          <div><span className="text-gray-600">Difference</span><strong className={`mt-1 block text-lg ${balanced ? "text-emerald-700" : "text-red-600"}`}>{currency.format(difference)}</strong></div>
        </div>
        <JournalSubmit disabled={!balanced || !validLines} />
      </div>
      <p className="flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800"><Scale className="mt-0.5 h-4 w-4 shrink-0" />Every posted journal must balance. Each line accepts either a debit or a credit, never both.</p>
    </form>
  );
}

function JournalSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button disabled={disabled || pending} type="submit">{pending ? "Posting journal…" : "Post balanced journal"}</Button>;
}
