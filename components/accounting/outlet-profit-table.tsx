import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { outletProfit } from "@/lib/accounting/outlet-profit";
import type { ProfitLossReport } from "@/lib/accounting/report-data";
import { profitLossGroups } from "@/lib/accounting/profit-loss-groups";
import { outletProfitExport, type ReportCompany } from "@/lib/accounting/financial-report-export";
import { FinancialPdfButton } from "@/components/accounting/financial-pdf-button";

const money = (value: number) => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);

export function OutletProfitTable({ report, outlets, startDate, endDate, company }: {
  report: ProfitLossReport; outlets: { id: string; name: string }[]; startDate: string; endDate: string; company: ReportCompany;
}) {
  const rows = outletProfit(report, outlets);
  const groups = profitLossGroups(report);
  const csv = [
    ["Outlet profit comparison", startDate, endDate, "Accrual basis"],
    ["Outlet", "Revenue RM", "Utilities RM", "Operating Expenses RM", "Total Expenses RM", "Net Profit / Loss RM"],
    ...rows.map((row) => [row.name, row.income.toFixed(2), row.utilities.toFixed(2), row.operating.toFixed(2), row.totalExpenses.toFixed(2), row.profit.toFixed(2)]),
    ["Total", report.totalRevenue.toFixed(2), groups.totalUtilities.toFixed(2), groups.totalOperating.toFixed(2), groups.totalExpenses.toFixed(2), report.netProfit.toFixed(2)],
  ];
  return <section className="mb-5 rounded-lg border border-[#d7dde5] p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">All outlets · profit &amp; loss comparison</h2>
      <div className="flex flex-wrap gap-2">
        <FinancialPdfButton report={outletProfitExport({ company, report, outlets, startDate, endDate })} />
        <CsvDownloadButton fileName={`DEKEZ-outlet-profit-${startDate}-to-${endDate}.csv`} label="Download outlet comparison" rows={csv} />
      </div>
    </div>
    <p className="mb-3 text-xs text-gray-600">{startDate} to {endDate}. Green = profit; red = loss. Office / unallocated entries remain separate and are not distributed to outlets. No activity means no income or costs recorded for this period.</p>
    <Table>
      <TableHeader><TableRow><TableHead>Outlet</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Utilities</TableHead><TableHead className="text-right">Operating Expenses</TableHead><TableHead className="text-right">Total Expenses</TableHead><TableHead className="text-right">Net Profit / Loss</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => <TableRow key={row.id}>
          <TableCell className="font-medium">{row.name}</TableCell><TableCell className="text-right">{money(row.income)}</TableCell><TableCell className="text-right">{money(row.utilities)}</TableCell><TableCell className="text-right">{money(row.operating)}</TableCell><TableCell className="text-right">{money(row.totalExpenses)}</TableCell>
          <TableCell className={`text-right font-semibold ${row.profit > 0.005 ? "text-emerald-700" : row.profit < -0.005 ? "text-red-700" : "text-gray-600"}`}>{money(row.profit)}</TableCell>
        </TableRow>)}
        <TableRow className="bg-slate-50 font-semibold"><TableCell>Total</TableCell><TableCell className="text-right">{money(report.totalRevenue)}</TableCell><TableCell className="text-right">{money(groups.totalUtilities)}</TableCell><TableCell className="text-right">{money(groups.totalOperating)}</TableCell><TableCell className="text-right">{money(groups.totalExpenses)}</TableCell><TableCell className="text-right">{money(report.netProfit)}</TableCell></TableRow>
      </TableBody>
    </Table>
  </section>;
}
