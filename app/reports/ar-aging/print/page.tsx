import { PrintButton } from "@/components/accounting/print-button";
import { arBucketKeys, arBucketLabels, arScopeNote, buildArAging, parseArParams, reconcileWithBalanceSheet, type ArAmounts } from "@/lib/accounting/ar-aging";
import { loadArAging } from "@/lib/accounting/ar-aging-data";
import { reportCompany } from "@/lib/accounting/financial-report-export";
import { voucherPageContext } from "@/lib/accounting/voucher-page-data";

type SearchParams = Promise<Record<string, string | undefined>>;
const money = (value: number) => value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (value: number) => (Math.abs(value) < 0.005 ? "-" : money(value));

function AmountCells({ amounts }: { amounts: ArAmounts }) {
  return <>{[amounts.current, amounts.d1_30, amounts.d31_60, amounts.d61_90, amounts.d90_plus, amounts.deposit, amounts.total].map((value, index) => <td className="text-right tabular-nums" key={index}>{cell(value)}</td>)}</>;
}

export default async function PrintArAgingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseArParams(await searchParams);
  const { company, supabase, properties } = await voucherPageContext();
  if (params.error) return <p className="p-6 text-sm">{params.error}</p>;
  const propertyId = properties.some((property) => property.id === params.property) ? params.property : "";
  const header = reportCompany(company);
  const data = await loadArAging(supabase, company.id, properties, params.asAt, propertyId || null);
  const aging = buildArAging(data.invoices, params.asAt, propertyId || null);
  const recon = reconcileWithBalanceSheet({ invoices: data.invoices, asAt: params.asAt, propertyId: propertyId || null, manual: data.manual }, data.overpaid);
  const propertyLabel = propertyId ? properties.find((property) => property.id === propertyId)?.name : "all properties";
  return (
    <div className="mx-auto max-w-5xl space-y-5 bg-white p-6 text-sm text-gray-900">
      <div className="flex justify-end print:hidden"><PrintButton /></div>
      <div className="border-b-2 border-gray-900 pb-3 text-center">
        <p className="text-xl font-bold">{header.name}</p>
        {header.registration ? <p className="text-xs">({header.registration})</p> : null}
        {header.address ? <p className="text-xs">{header.address}</p> : null}
      </div>
      <p className="text-center text-lg font-semibold">AR AGING</p>
      <p className="text-center text-xs">As at {params.asAt} · {propertyLabel} · amounts in RM</p>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-gray-900 text-left">
            <th className="py-1">Property / tenant / invoice</th>
            {arBucketKeys.map((key) => <th className="text-right" key={key}>{arBucketLabels[key]}</th>)}
            <th className="text-right">Unpaid deposit</th><th className="text-right">Total</th>
          </tr>
        </thead>
        {aging.properties.map((property) => (
          <tbody key={property.propertyId}>
            <tr className="border-b border-gray-900 bg-gray-100 font-semibold"><td className="py-1">{property.name}</td><AmountCells amounts={property.amounts} /></tr>
            {property.tenants.map((tenant) => (
              <TenantRows key={tenant.key} tenant={tenant} />
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t-2 border-gray-900 text-xs font-bold"><td className="py-1">GRAND TOTAL ({aging.invoiceCount} invoices)</td><AmountCells amounts={aging.totals} /></tr>
        </tfoot>
      </table>
      {!aging.invoiceCount ? <p className="text-center text-xs">Nothing is outstanding for this selection.</p> : null}

      <section className="break-inside-avoid-page">
        <p className="border-b border-gray-900 pb-1 font-semibold">Reconciliation with the Balance Sheet</p>
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            <tr className="border-b"><td className="py-1 font-semibold">AR aging total</td><td className="text-right">{money(recon.agingTotal)}</td></tr>
            {recon.notYetDue ? <tr className="border-b"><td className="py-1 pl-3">Less: invoices not yet due</td><td className="text-right">{money(-recon.notYetDue)}</td></tr> : null}
            {recon.dueButDatedLater ? <tr className="border-b"><td className="py-1 pl-3">Add: invoices already due but dated after the as-at date</td><td className="text-right">{money(recon.dueButDatedLater)}</td></tr> : null}
            <tr className="border-b"><td className="py-1 font-semibold">Invoice receivables counted by the Balance Sheet</td><td className="text-right">{money(recon.invoiceReceivable)}</td></tr>
            {recon.manual.map((row) => <tr className="border-b" key={row.label}><td className="py-1 pl-3">{row.label}</td><td className="text-right">{money(row.rental + row.deposit)}</td></tr>)}
            <tr className="border-t border-gray-900 font-semibold"><td className="py-1">Balance Sheet: Rental receivables {money(recon.balanceSheetRental)} + Deposit receivables {money(recon.balanceSheetDeposit)}</td><td className="text-right">{money(recon.balanceSheetTotal)}</td></tr>
          </tbody>
        </table>
        {recon.futureDated.count ? <p className="mt-1 text-[10px] text-gray-600">Not in either figure: {recon.futureDated.count} invoice(s) already generated for later dates, RM {money(recon.futureDated.amount)}.</p> : null}
      </section>
      <p className="text-[10px] text-gray-500">{arScopeNote}</p>
      <p className="text-right text-xs text-gray-500">Printed {new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT</p>
    </div>
  );
}

function TenantRows({ tenant }: { tenant: ReturnType<typeof buildArAging>["properties"][number]["tenants"][number] }) {
  return (
    <>
      <tr className="border-b border-gray-300 font-medium"><td className="py-1 pl-2">{tenant.name} <span className="font-normal text-gray-500">{tenant.rooms.join(", ")}</span></td><AmountCells amounts={tenant.amounts} /></tr>
      {tenant.invoices.map((invoice) => (
        <tr className="border-b border-gray-100 text-[10px] text-gray-700" key={invoice.id}>
          <td className="py-0.5 pl-6"><span className="font-mono">{invoice.invoiceNumber}</span>{invoice.aliasNumber ? <span className="font-mono text-gray-500"> / {invoice.aliasNumber}</span> : null} · due {invoice.dueDate || "-"}{invoice.daysOverdue > 0 ? ` · ${invoice.daysOverdue}d` : ""}</td>
          {arBucketKeys.map((key) => <td className="text-right tabular-nums" key={key}>{invoice.bucket === key && invoice.rentOutstanding > 0.005 ? money(invoice.rentOutstanding) : ""}</td>)}
          <td className="text-right tabular-nums">{invoice.depositOutstanding > 0.005 ? money(invoice.depositOutstanding) : ""}</td>
          <td className="text-right tabular-nums">{money(invoice.total)}</td>
        </tr>
      ))}
    </>
  );
}
