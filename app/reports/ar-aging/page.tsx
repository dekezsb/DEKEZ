import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { arBucketKeys, arBucketLabels, arCsvRows, arQuery, arScopeNote, buildArAging, parseArParams, reconcileWithBalanceSheet, type ArAmounts } from "@/lib/accounting/ar-aging";
import { loadArAging } from "@/lib/accounting/ar-aging-data";
import { reportCompany } from "@/lib/accounting/financial-report-export";
import { voucherPageContext } from "@/lib/accounting/voucher-page-data";

type SearchParams = Promise<Record<string, string | undefined>>;
const money = (value: number) => value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (value: number) => (Math.abs(value) < 0.005 ? "-" : money(value));
const gridCols = "grid grid-cols-[minmax(220px,2.2fr)_repeat(7,minmax(92px,1fr))] items-baseline gap-2";
const statusLabel = (status: string) => status.replaceAll("_", " ");

function AmountCells({ amounts, bold }: { amounts: ArAmounts; bold?: boolean }) {
  const values = [amounts.current, amounts.d1_30, amounts.d31_60, amounts.d61_90, amounts.d90_plus, amounts.deposit, amounts.total];
  return <>{values.map((value, index) => <span className={`text-right tabular-nums ${bold || index === 6 ? "font-semibold" : ""}`} key={index}>{cell(value)}</span>)}</>;
}

export default async function ArAgingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseArParams(await searchParams);
  const { company, supabase, properties } = await voucherPageContext();
  const propertyId = properties.some((property) => property.id === params.property) ? params.property : "";
  const data = params.error ? null : await loadArAging(supabase, company.id, properties, params.asAt, propertyId || null);
  const aging = data ? buildArAging(data.invoices, params.asAt, propertyId || null) : null;
  const recon = data ? reconcileWithBalanceSheet({ invoices: data.invoices, asAt: params.asAt, propertyId: propertyId || null, manual: data.manual }, data.overpaid) : null;
  const query = arQuery({ asAt: params.asAt, property: propertyId });
  const header = reportCompany(company);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline" href="/reports?tab=balance-sheet"><ArrowLeft className="h-4 w-4" />Accounts &amp; Reports</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-950">AR Aging</h1>
          <p className="text-sm text-gray-600">Who owes {header.name}, how much, and for how long. Open a tenant to see each invoice.</p>
        </div>
        {aging && aging.invoiceCount ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={`/reports/ar-aging/print?${query}`} target="_blank"><Printer className="h-4 w-4" />Print / PDF</Link></Button>
            <CsvDownloadButton fileName={`DEKEZ-ar-aging-${params.asAt}.csv`} label="Export CSV" rows={arCsvRows(aging, header.name)} />
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>{arScopeNote}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-4" method="get">
            <label className="text-sm">As at<input className="mt-1 block h-10 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={params.asAt} name="asAt" required type="date" /></label>
            <label className="text-sm sm:col-span-2">Property
              <select className="mt-1 block h-10 w-full rounded-md border border-[#d7dde5] bg-white px-2" defaultValue={propertyId} name="property">
                <option value="">All properties</option>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </label>
            <div className="flex items-end"><Button type="submit">Show aging</Button></div>
          </form>
          {params.error ? <p className="mt-3 text-sm text-red-700">{params.error}</p> : null}
        </CardContent>
      </Card>

      {aging ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Outstanding as at {params.asAt}</CardTitle>
            <CardDescription>{aging.invoiceCount} open invoice{aging.invoiceCount === 1 ? "" : "s"} · Total outstanding RM {money(aging.totals.total)}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!aging.invoiceCount ? <p className="text-sm text-gray-600">Nothing is outstanding for this selection.</p> : (
              <div className="min-w-[980px] text-sm">
                <div className={`${gridCols} border-b py-2 text-xs font-semibold uppercase text-gray-500`}>
                  <span>Property / tenant</span>
                  {arBucketKeys.map((key) => <span className="text-right" key={key}>{arBucketLabels[key]}</span>)}
                  <span className="text-right">Unpaid deposit</span>
                  <span className="text-right">Total</span>
                </div>
                {aging.properties.map((property) => (
                  <div key={property.propertyId}>
                    <div className={`${gridCols} border-b bg-gray-100 py-2`}>
                      <span className="font-semibold">{property.name}</span>
                      <AmountCells amounts={property.amounts} bold />
                    </div>
                    {property.tenants.map((tenant) => (
                      <details className="group border-b" key={tenant.key}>
                        <summary className={`${gridCols} cursor-pointer list-none py-2 hover:bg-gray-50`}>
                          <span><span className="mr-1 inline-block text-gray-400 transition-transform group-open:rotate-90">▸</span>{tenant.name}<span className="ml-2 text-xs text-gray-500">{tenant.rooms.join(", ")} · {tenant.invoices.length} invoice{tenant.invoices.length === 1 ? "" : "s"}</span></span>
                          <AmountCells amounts={tenant.amounts} />
                        </summary>
                        <div className="mb-3 ml-5 overflow-x-auto rounded-md border bg-gray-50 p-2">
                          <table className="w-full min-w-[820px] border-collapse text-xs">
                            <thead><tr className="border-b text-left uppercase text-gray-500"><th className="py-1">Invoice no.</th><th>Other no.</th><th>Invoice date</th><th>Due date</th><th className="text-right">Days overdue</th><th>Status</th><th className="text-right">Invoice</th><th className="text-right">Paid</th><th className="text-right">Rent owing</th><th className="text-right">Deposit owing</th><th className="text-right">Aging</th></tr></thead>
                            <tbody>
                              {tenant.invoices.map((invoice) => (
                                <tr className="border-b border-gray-200 align-top" key={invoice.id}>
                                  <td className="py-1 font-mono"><Link className="text-blue-700 underline" href={invoice.href}>{invoice.invoiceNumber}</Link></td>
                                  <td className="font-mono text-gray-600">{invoice.aliasNumber ?? ""}</td>
                                  <td className="whitespace-nowrap">{invoice.invoiceDate}</td>
                                  <td className="whitespace-nowrap">{invoice.dueDate || "-"}</td>
                                  <td className="text-right">{invoice.daysOverdue > 0 ? invoice.daysOverdue : "-"}</td>
                                  <td><Badge variant="neutral">{statusLabel(invoice.status)}</Badge></td>
                                  <td className="text-right tabular-nums">{money(invoice.invoiceAmount)}</td>
                                  <td className="text-right tabular-nums">{money(invoice.paidAmount)}</td>
                                  <td className="text-right tabular-nums">{cell(invoice.rentOutstanding)}</td>
                                  <td className="text-right tabular-nums">{cell(invoice.depositOutstanding)}</td>
                                  <td className="text-right">{invoice.rentOutstanding > 0.005 ? arBucketLabels[invoice.bucket] : "Deposit"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}
                  </div>
                ))}
                <div className={`${gridCols} border-t-2 border-gray-900 py-3 text-base`}>
                  <span className="font-semibold">Grand total</span>
                  <AmountCells amounts={aging.totals} bold />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {recon ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Reconciliation with the Balance Sheet</CardTitle>
            <CardDescription>
              {Math.abs(recon.difference) < 0.005
                ? "The aging total agrees with Rental receivables + Deposit receivables on the Balance Sheet."
                : `The aging total is RM ${money(Math.abs(recon.difference))} ${recon.difference > 0 ? "higher" : "lower"} than the Balance Sheet receivables. The lines below explain it.`}
              {propertyId ? " Historical bank credits are company-wide, so they are left out when one property is selected." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <tbody>
                <tr className="border-b font-semibold"><td className="py-2">AR aging total (this report)</td><td className="text-right tabular-nums">{money(recon.agingTotal)}</td></tr>
                {recon.notYetDue ? <tr className="border-b"><td className="py-2 pl-4">Less: invoices not yet due at {params.asAt} (the Balance Sheet counts invoices once due)</td><td className="text-right tabular-nums">{money(-recon.notYetDue)}</td></tr> : null}
                {recon.dueButDatedLater ? <tr className="border-b"><td className="py-2 pl-4">Add: {recon.dueButDatedLaterCount} invoice(s) already due but dated after {params.asAt} (the Balance Sheet counts them)</td><td className="text-right tabular-nums">{money(recon.dueButDatedLater)}</td></tr> : null}
                <tr className="border-b font-semibold"><td className="py-2">Invoice receivables counted by the Balance Sheet</td><td className="text-right tabular-nums">{money(recon.invoiceReceivable)}</td></tr>
                {recon.manual.map((row) => <tr className="border-b" key={row.label}><td className="py-2 pl-4">{row.label}<span className="block text-xs text-gray-500">Rental receivables {money(row.rental)} · Deposit receivables {money(row.deposit)}</span></td><td className="text-right tabular-nums">{money(row.rental + row.deposit)}</td></tr>)}
                <tr className="border-t-2 border-gray-900 font-semibold"><td className="py-2">Balance Sheet: Rental receivables + Deposit receivables</td><td className="text-right tabular-nums">{money(recon.balanceSheetTotal)}</td></tr>
                <tr className="text-xs text-gray-600"><td className="py-1 pl-4">of which Rental receivables {money(recon.balanceSheetRental)} · Deposit receivables {money(recon.balanceSheetDeposit)}</td><td /></tr>
              </tbody>
            </table>
            <div className="mt-3 space-y-1 text-xs text-gray-600">
              {recon.futureDated.count ? <p>Not in either figure: {recon.futureDated.count} invoice(s) already generated for dates after {params.asAt}, RM {money(recon.futureDated.amount)}.</p> : null}
              {recon.overpaid.count ? <p>{recon.overpaid.count} invoice(s) are paid RM {money(recon.overpaid.amount)} above their amount. That credit is not deducted from other invoices, here or on the Balance Sheet.</p> : null}
              {Math.abs(recon.manualRental + recon.manualDeposit) > 0.005 ? <p>The postings above sit directly on the receivable accounts, so they are not invoices and cannot be aged. Review them under Reports → Journal Entries / General Ledger (accounts 1100 and 1110).</p> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
