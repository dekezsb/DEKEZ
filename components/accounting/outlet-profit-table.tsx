import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { outletProfit } from "@/lib/accounting/outlet-profit";
import type { ProfitLossReport } from "@/lib/accounting/report-data";

const money = (value: number) => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);

export function OutletProfitTable({ report, outlets, startDate, endDate }: {
  report: ProfitLossReport; outlets: { id: string; name: string }[]; startDate: string; endDate: string;
}) {
  const rows = outletProfit(report, outlets);
  const csv = [
    ["Outlet profit comparison", startDate, endDate, "Accrual basis"],
    ["Outlet", "Income RM", "Direct costs RM", "Operating expenses RM", "Net profit / loss RM"],
    ...rows.map((row) => [row.name, row.income.toFixed(2), row.costs.toFixed(2), row.expenses.toFixed(2), row.profit.toFixed(2)]),
    ["Total", report.totalRevenue.toFixed(2), report.totalCostOfSales.toFixed(2), report.totalExpenses.toFixed(2), report.netProfit.toFixed(2)],
  ];
  return <section className="mb-5 rounded-lg border border-[#d7dde5] p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">All outlets · profit &amp; loss comparison</h2>
      <CsvDownloadButton fileName={`DEKEZ-outlet-profit-${startDate}-to-${endDate}.csv`} label="Download outlet comparison" rows={csv} />
    </div>
    <p className="mb-3 text-xs text-gray-600">{startDate} to {endDate}. Green = profit; red = loss. Office / unallocated entries remain separate and are not distributed to outlets. No activity means no income or costs recorded for this period.</p>
    <Table>
      <TableHeader><TableRow><TableHead>Outlet</TableHead><TableHead className="text-right">Income</TableHead><TableHead className="text-right">Direct costs</TableHead><TableHead className="text-right">Operating expenses</TableHead><TableHead className="text-right">Net profit / loss</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => <TableRow key={row.id}>
          <TableCell className="font-medium">{row.name}</TableCell><TableCell className="text-right">{money(row.income)}</TableCell><TableCell className="text-right">{money(row.costs)}</TableCell><TableCell className="text-right">{money(row.expenses)}</TableCell>
          <TableCell className={`text-right font-semibold ${row.profit > 0.005 ? "text-emerald-700" : row.profit < -0.005 ? "text-red-700" : "text-gray-600"}`}>{money(row.profit)}</TableCell>
          <TableCell>{row.profit > 0.005 ? "Profit" : row.profit < -0.005 ? "Loss" : row.income === 0 && row.costs === 0 && row.expenses === 0 ? "No activity" : "Break-even"}</TableCell>
        </TableRow>)}
        <TableRow className="bg-slate-50 font-semibold"><TableCell>Total</TableCell><TableCell className="text-right">{money(report.totalRevenue)}</TableCell><TableCell className="text-right">{money(report.totalCostOfSales)}</TableCell><TableCell className="text-right">{money(report.totalExpenses)}</TableCell><TableCell className="text-right">{money(report.netProfit)}</TableCell><TableCell /></TableRow>
      </TableBody>
    </Table>
  </section>;
}
