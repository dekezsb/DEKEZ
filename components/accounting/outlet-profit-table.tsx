import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProfitLossReport } from "@/lib/accounting/report-data";
import { outletComparison, outletComparisonColumns, comparisonAmounts } from "@/lib/accounting/outlet-comparison";
import { outletProfitExport, reportMoney, type ReportCompany } from "@/lib/accounting/financial-report-export";
import { FinancialPdfButton } from "@/components/accounting/financial-pdf-button";

export function OutletProfitTable({ report, outlets, startDate, endDate, company }: {
  report: ProfitLossReport; outlets: { id: string; name: string }[]; startDate: string; endDate: string; company: ReportCompany;
}) {
  const {rows, totals, warnings} = outletComparison(report, outlets);
  const csv = [["All Outlets Profit & Loss Comparison", startDate, endDate, "Accrual basis"],
    outletComparisonColumns, ...rows.map(row => [row.name, ...comparisonAmounts(row).map(value => value.toFixed(2))]),
    ["TOTAL", ...comparisonAmounts(totals).map(value => value.toFixed(2))], ...warnings.map(warning => ["REVIEW REQUIRED", warning])];
  const amounts = (row: typeof totals) => comparisonAmounts(row).map((value, index) =>
    <TableCell key={index} className={`whitespace-nowrap border-l text-right tabular-nums ${index >= 6 ? "font-bold" : ""} ${index === 7 ? value < -.005 ? "!text-red-700" : value > .005 ? "!text-emerald-700" : "text-gray-700" : ""}`}>{reportMoney(value)}</TableCell>);
  return <section className="mb-5 min-w-0 max-w-full rounded-xl border border-[#ded6c7] bg-white/60 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">All outlets · profit &amp; loss comparison</h2>
      <div className="flex flex-wrap gap-2">
        <FinancialPdfButton report={outletProfitExport({company, report, outlets, startDate, endDate})} />
        <CsvDownloadButton fileName={`DEKEZ-outlet-profit-${startDate}-to-${endDate}.csv`} label="Download outlet comparison" rows={csv} />
      </div>
    </div>
    <p className="mb-3 text-sm text-gray-600">Reporting period: {startDate} to {endDate}. All amounts in RM. Office / Unallocated remains separate. Scroll horizontally to view all columns on smaller screens.</p>
    {warnings.map(warning => <p key={warning} role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{warning}</p>)}
    <div role="region" aria-label="All outlets profit and loss comparison" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700">
      <Table className="min-w-[1600px] table-auto">
        <caption className="p-3 text-left text-sm text-gray-600">Positive profit is green; losses are red and have a minus sign. No activity shows RM 0.00.</caption>
        <TableHeader><TableRow>{outletComparisonColumns.map((heading, index) => <TableHead key={heading} scope="col" className={`py-4 text-sm ${index ? "min-w-[155px] border-l text-right" : "min-w-[290px] text-left"}`}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.id} className={row.id === "unallocated" ? "border-t-2 bg-amber-50/50" : "even:bg-stone-50/60"}>
          <TableHead scope="row" className="whitespace-normal py-4 text-sm font-medium text-gray-900">{row.name}</TableHead>{amounts(row)}
        </TableRow>)}</TableBody>
        <tfoot className="border-t-2 border-[#b99a58] bg-[#f6f0e3] font-bold"><TableRow><TableHead scope="row" className="py-4 text-sm font-bold text-gray-900">TOTAL</TableHead>{amounts(totals)}</TableRow></tfoot>
      </Table>
    </div>
  </section>;
}
