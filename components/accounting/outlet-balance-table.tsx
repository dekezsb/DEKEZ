import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type OutletBalanceEntry = { propertyId: string | null; section: "Assets" | "Liabilities" | "Equity"; label: string; amount: number };
const money = (n: number) => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

export function OutletBalanceTable({ outlets, entries, date }: { outlets: { id: string; name: string }[]; entries: OutletBalanceEntry[]; date: string }) {
  const knownIds = new Set(outlets.map((o) => o.id));
  const columns = [...outlets, { id: "unallocated", name: "Office / unallocated" }];
  const normalized = entries.map((e) => ({ ...e, propertyId: e.propertyId && knownIds.has(e.propertyId) ? e.propertyId : "unallocated" }));
  const rows = (["Assets", "Liabilities", "Equity"] as const).flatMap((section) => {
    const selected = normalized.filter((e) => e.section === section);
    const labels = [...new Set(selected.map((e) => e.label))];
    return [...labels.map((label) => ({ section, label, values: columns.map((o) => selected.filter((e) => e.label === label && e.propertyId === o.id).reduce((s, e) => s + e.amount, 0)), total: false })),
      { section, label: `Total ${section}`, values: columns.map((o) => selected.filter((e) => e.propertyId === o.id).reduce((s, e) => s + e.amount, 0)), total: true }];
  });
  const csv = [["Balance Sheet outlet breakdown", `As at ${date}`], ["Section", "Account", ...columns.map((o) => o.name), "Company total"], ...rows.map((r) => [r.section, r.label, ...r.values.map((v) => v.toFixed(2)), r.values.reduce((s, v) => s + v, 0).toFixed(2)])];
  return <section className="rounded-lg border border-[#d7dde5] bg-white p-4">
    <div className="mb-3 flex flex-wrap justify-between gap-3"><h2 className="font-semibold">All outlets · Balance Sheet breakdown</h2><CsvDownloadButton fileName={`DEKEZ-outlet-balance-sheet-${date}.csv`} label="Download outlet balance sheet" rows={csv} /></div>
    <p className="mb-3 text-xs text-gray-600">As at {date}, using the balances in the report below. Shared bank balances and entries without an outlet are shown once under Office / unallocated. Outlet columns are management allocations, not standalone balanced accounts. Historical open balances use currently recorded settlement status; this is not a frozen historical snapshot.</p>
    <Table><TableHeader><TableRow><TableHead>Account</TableHead>{columns.map((o) => <TableHead key={o.id} className="min-w-36 text-right">{o.name}</TableHead>)}<TableHead className="text-right">Company total</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((r) => <TableRow key={`${r.section}-${r.label}`} className={r.total ? "bg-slate-100 font-semibold" : ""}><TableCell className="min-w-56">{r.label}</TableCell>{r.values.map((v, i) => <TableCell key={columns[i].id} className="text-right">{money(v)}</TableCell>)}<TableCell className="text-right font-semibold">{money(r.values.reduce((s, v) => s + v, 0))}</TableCell></TableRow>)}</TableBody>
    </Table>
  </section>;
}
