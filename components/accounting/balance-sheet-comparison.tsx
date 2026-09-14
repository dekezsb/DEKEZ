"use client";

import { useState } from "react";
import { balanceComparison, type BalanceDetail, type BalanceSnapshot } from "@/lib/accounting/balance-breakdown";
import { CsvDownloadButton } from "./csv-download-button";

const money = (n: number) => new Intl.NumberFormat("en-MY", {style: "currency", currency: "MYR"}).format(n);
const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"});

function SupportingRows({details, date, amount}: {details: BalanceDetail[]; date: string; amount: number}) {
  return <div className="min-w-0 rounded-md border bg-white p-3">
    <h4 className="mb-2 font-semibold">As at {dateLabel(date)} · {money(amount)}</h4>
    <div className="max-h-96 overflow-auto"><table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Date / reference</th><th className="p-2">Outlet / supporting record</th><th className="p-2 text-right">Balance effect</th></tr></thead>
      <tbody>{details.map((line) => <tr key={line.id} className="border-t"><td className="p-2 align-top">{dateLabel(line.date)}<div className="break-all text-slate-500">{line.reference}</div></td><td className="p-2">{line.propertyName}<div>{line.description}</div><div className="text-slate-500">{line.source}</div></td><td className="whitespace-nowrap p-2 text-right align-top">{money(line.amount)}</td></tr>)}</tbody>
      <tfoot><tr className="border-t font-semibold"><td className="p-2" colSpan={2}>Supporting total · {details.length} records</td><td className="p-2 text-right">{money(details.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100)}</td></tr></tfoot>
    </table>{!details.length ? <p className="p-3 text-xs text-slate-500">No supporting activity recorded for this balance.</p> : null}</div>
  </div>;
}

export function BalanceSheetComparison({current, prior, scope}: {current: BalanceSnapshot; prior: BalanceSnapshot; scope: string}) {
  const [showZero, setShowZero] = useState(true);
  const [search, setSearch] = useState("");
  const rows = balanceComparison(current, prior);
  const sections = ["Assets", "Liabilities", "Equity"] as const;
  const total = (section: string, key: "amount" | "priorAmount") => rows.filter((row) => row.section === section).reduce((sum, row) => sum + Math.round(row[key] * 100), 0) / 100;
  const difference = (key: "amount" | "priorAmount") => total("Assets", key) - total("Liabilities", key) - total("Equity", key);
  const csv = [["Balance Sheet comparison", scope], ["Section", "Code", "Account", `As at ${current.date}`, `As at ${prior.date}`, "Change RM"], ...rows.map((row) => [row.section, row.code, row.label, row.amount.toFixed(2), row.priorAmount.toFixed(2), row.change.toFixed(2)]), ...sections.map((section) => [section, "", `Total ${section}`, total(section, "amount").toFixed(2), total(section, "priorAmount").toFixed(2), (total(section, "amount") - total(section, "priorAmount")).toFixed(2)]), ["Control", "", "Unexplained difference", difference("amount").toFixed(2), difference("priorAmount").toFixed(2), ""]];
  const ledgerCsv = [["As at", "Section", "Code", "Account", "Date", "Reference", "Outlet", "Description", "Source", "Balance effect RM"], ...[current, prior].flatMap((snapshot) => snapshot.rows.flatMap((row) => row.details.map((line) => [snapshot.date, row.section, row.code, row.label, line.date, line.reference, line.propertyName, line.description, line.source, line.amount.toFixed(2)])))];
  return <section className="space-y-4 rounded-lg border bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Balance Sheet · comparison &amp; breakdown</h2><p className="text-sm text-slate-600">{scope} · {dateLabel(current.date)} compared with {dateLabel(prior.date)}</p></div><div className="flex flex-wrap gap-2"><CsvDownloadButton fileName={`DEKEZ-balance-comparison-${current.date}.csv`} label="Download comparison" rows={csv} /><CsvDownloadButton fileName={`DEKEZ-balance-ledger-${current.date}.csv`} label="Download supporting records" rows={ledgerCsv} /></div></div>
    <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-950">Click any account row to see both dates’ supporting records. Assets, liabilities and equity are shown separately; income and expenses form current-year profit. These are balances at each date, not the sum of monthly balances.</p>
    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Historical limitation: invoice and bill outstanding balances use currently recorded settlement status. Comparisons are management reconstructions, not frozen month-end accounts. Bank figures use the latest imported statement available by each date; its actual date is shown in the breakdown. Shared bank balances remain company-level.</p>
    <div className="flex flex-wrap items-center gap-4"><label className="text-sm">Find account<input className="ml-2 rounded border px-3 py-2" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code or account name" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />Show zero-balance accounts</label></div>
    <div className="overflow-x-auto"><div className="min-w-[48rem]">
    <div className="grid grid-cols-[minmax(12rem,1fr)_9rem_9rem_9rem] gap-3 border-b pb-2 text-right text-xs font-semibold"><span className="text-left">Account · click to expand</span><span>{dateLabel(current.date)}</span><span>{dateLabel(prior.date)}</span><span>Change RM</span></div>
    {sections.map((section) => <div key={section} className="space-y-1"><h3 className="rounded bg-slate-100 px-3 py-2 font-semibold">{section}</h3>{rows.filter((row) => row.section === section && (showZero || row.amount || row.priorAmount) && `${row.code} ${row.label}`.toLowerCase().includes(search.toLowerCase())).map((row) => <details key={row.key} className="rounded border border-slate-200 open:bg-slate-50"><summary className="grid cursor-pointer grid-cols-[minmax(12rem,1fr)_9rem_9rem_9rem] items-center gap-3 px-3 py-3 text-sm hover:bg-blue-50"><span>▸ {row.code} · {row.label}</span><strong>{money(row.amount)}</strong><span>{money(row.priorAmount)}</span><span>{money(row.change)}</span></summary><div className="grid gap-3 border-t p-3 xl:grid-cols-2"><SupportingRows details={row.details} date={current.date} amount={row.amount} /><SupportingRows details={row.priorDetails} date={prior.date} amount={row.priorAmount} /></div></details>)}<div className="grid grid-cols-[minmax(12rem,1fr)_9rem_9rem_9rem] gap-3 px-3 py-2 text-sm font-bold"><span>Total {section}</span><span>{money(total(section, "amount"))}</span><span>{money(total(section, "priorAmount"))}</span><span>{money(total(section, "amount") - total(section, "priorAmount"))}</span></div></div>)}
    </div></div>
    <div className={`rounded border p-4 text-sm ${Math.abs(difference("amount")) < .005 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50 text-red-950"}`}><strong>Assets − Liabilities − Equity: {money(difference("amount"))}</strong><p>Comparison date difference: {money(difference("priorAmount"))}. Any difference needs investigation of opening balances and supporting records; it is not automatically an expense, income or an approved adjustment.</p></div>
  </section>;
}
