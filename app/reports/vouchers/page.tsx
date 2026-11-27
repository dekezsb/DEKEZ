import Link from "next/link";
import { ArrowLeft, FileText, Pencil, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { VoucherForm } from "@/components/accounting/voucher-form";
import { loadVoucherRegister } from "@/lib/accounting/voucher-data";
import { voucherPageContext } from "@/lib/accounting/voucher-page-data";
import { editHref, filterRegister, printHref, registerCsvRows, statusLabel, voucherErrorMessages, voucherTypeLabels, type RegisterRow, type VoucherType } from "@/lib/accounting/vouchers";

type SearchParams = Promise<Record<string, string | undefined>>;
const money = (value: number) => `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusClass = (row: RegisterRow) => row.status === "voided" ? "bg-red-100 text-red-800" : row.revision > 1 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);


export default async function VouchersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { company, supabase, accounts, paymentAccounts, properties } = await voucherPageContext();
  const allRows = await loadVoucherRegister(supabase, company.id);
  const filters = { type: params.type, status: params.status, from: params.from, to: params.to, property: params.property, q: params.q };
  const rows = filterRegister(allRows, filters);
  const propertyNames = new Map(properties.map((property) => [property.id, property.name]));
  const newType = (["PV", "RV", "JV"] as const).find((type) => type === params.new) as VoucherType | undefined;
  const error = params.error ? voucherErrorMessages[params.error] ?? voucherErrorMessages.voucher_failed : "";
  const totals = { PV: 0, RV: 0, JV: 0 } as Record<VoucherType, number>;
  for (const row of rows) if (row.status !== "voided") totals[row.type] += row.amount;
  const listQuery = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline" href="/reports?tab=journal"><ArrowLeft className="h-4 w-4" />Accounts &amp; Reports</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-950">Vouchers &amp; Journals</h1>
          <p className="text-sm text-gray-600">Every Payment Voucher (PV), Receipt Voucher (RV) and Journal (JV) in one register. Click Edit to correct anything; the system keeps the audit trail for you.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["PV", "RV", "JV"] as const).map((type) => <Button asChild key={type} variant={newType === type ? "default" : "outline"}><Link href={`/reports/vouchers?new=${type}`}><FileText className="h-4 w-4" />New {voucherTypeLabels[type]}</Link></Button>)}
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      {params.saved ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Voucher saved and posted to the ledger.</div> : null}
      {params.amended ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Changes saved. The old entry was reversed automatically and the corrected entry posted under the same number.</div> : null}
      {params.voided ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Voided. An automatic reversal was posted and the reason is kept in the audit trail.</div> : null}

      {newType ? (
        <Card>
          <CardHeader><CardTitle>New {voucherTypeLabels[newType]}</CardTitle><CardDescription>{newType === "PV" ? "Money paid out (cash or bank). Each line is the expense / account being paid." : newType === "RV" ? "Money received (cash or bank). Each line is the income / account being received." : "Adjustments with no cash movement: accruals, depreciation, reclassifications. Debit must equal credit."}</CardDescription></CardHeader>
          <CardContent>
            <VoucherForm accounts={accounts} initial={{ date: today(), party: "", propertyId: "", paymentAccountId: "", reference: "", description: "", lines: [] }} mode="new" paymentAccounts={paymentAccounts} properties={properties} type={newType} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><CardTitle>Voucher Register</CardTitle><CardDescription>{rows.length} of {allRows.length} documents · PV {money(totals.PV)} · RV {money(totals.RV)} · JV {money(totals.JV)} (voided excluded)</CardDescription></div>
            <div className="flex flex-wrap gap-2">
              <CsvDownloadButton fileName={`DEKEZ-voucher-register-${today()}.csv`} label="Export CSV" rows={registerCsvRows(rows, propertyNames)} />
              <Button asChild variant="outline"><Link href={`/reports/vouchers/print?list=1${listQuery ? `&${listQuery}` : ""}`} target="_blank"><Printer className="h-4 w-4" />Print / PDF list</Link></Button>
            </div>
          </div>
          <form className="grid gap-2 md:grid-cols-7" method="get">
            <select className="h-10 rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={params.type ?? ""} name="type"><option value="">All types</option><option value="PV">Payment (PV)</option><option value="RV">Receipt (RV)</option><option value="JV">Journal (JV)</option></select>
            <select className="h-10 rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={params.status ?? ""} name="status"><option value="">All statuses</option><option value="posted">Posted</option><option value="amended">Amended</option><option value="voided">Voided</option></select>
            <input aria-label="From date" className="h-10 rounded-md border border-[#d7dde5] px-2 text-sm" defaultValue={params.from ?? ""} name="from" type="date" />
            <input aria-label="To date" className="h-10 rounded-md border border-[#d7dde5] px-2 text-sm" defaultValue={params.to ?? ""} name="to" type="date" />
            <select className="h-10 rounded-md border border-[#d7dde5] bg-white px-2 text-sm" defaultValue={params.property ?? ""} name="property"><option value="">All properties</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select>
            <input className="h-10 rounded-md border border-[#d7dde5] px-2 text-sm" defaultValue={params.q ?? ""} name="q" placeholder="Search no., payee, amount" />
            <div className="flex gap-2"><Button type="submit">Filter</Button><Button asChild variant="ghost"><Link href="/reports/vouchers">Clear</Link></Button></div>
          </form>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Voucher no.</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Payee / payer / description</TableHead><TableHead>Property</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.slice(0, 500).map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="align-top"><span className="font-mono text-xs font-semibold text-[#7a5618]">{row.number}</span>{row.aliasNumber ? <span className="block font-mono text-[11px] text-gray-500">{row.aliasNumber}</span> : null}</TableCell>
                  <TableCell className="align-top whitespace-nowrap">{row.date}</TableCell>
                  <TableCell className="align-top"><span title={voucherTypeLabels[row.type]}>{row.type}</span><span className="block text-[11px] text-gray-500">{row.sourceLabel}</span></TableCell>
                  <TableCell className="align-top max-w-[340px]">
                    {row.party ? <p className="font-medium">{row.party}</p> : null}
                    <p className="text-sm text-gray-600">{row.description}</p>
                    {row.reference ? <p className="text-xs text-gray-500">Ref: {row.reference}</p> : null}
                    {row.history.length > 1 ? (
                      <details className="mt-1 text-xs"><summary className="cursor-pointer text-[#7a5618]">History ({row.history.length})</summary>
                        <ul className="mt-1 space-y-1">{row.history.map((item, index) => <li key={`${item.revision}-${index}`}>{item.at.slice(0, 16).replace("T", " ")} · {item.label} · {money(item.amount)}{item.reason ? ` · Reason: ${item.reason}` : ""}</li>)}</ul>
                      </details>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top text-sm">{row.propertyIds.map((id) => propertyNames.get(id)).filter(Boolean).join(", ") || "General"}</TableCell>
                  <TableCell className="align-top text-right font-semibold">{money(row.amount)}</TableCell>
                  <TableCell className="align-top"><Badge className={statusClass(row)}>{statusLabel(row)}</Badge></TableCell>
                  <TableCell className="align-top text-right">
                    <div className="flex justify-end gap-1">
                      {row.editable ? <Button asChild size="sm" variant="outline"><Link href={editHref(row)}><Pencil className="h-3.5 w-3.5" />Edit</Link></Button> : <Button asChild size="sm" variant="ghost"><Link href={editHref(row)} title={row.notEditableReason ?? ""}>View</Link></Button>}
                      <Button asChild size="sm" variant="ghost"><Link href={printHref(row)} target="_blank"><Printer className="h-3.5 w-3.5" /></Link></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length ? <p className="rounded-md bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">No vouchers match these filters.</p> : null}
          {rows.length > 500 ? <p className="mt-3 text-xs text-gray-500">Showing the latest 500. Narrow the dates or use Export CSV for the full list.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
