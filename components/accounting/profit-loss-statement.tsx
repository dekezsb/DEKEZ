import { ChevronRight } from "lucide-react";
import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProfitLossReport, ProfitLossRow } from "@/lib/accounting/report-data";

const moneyFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function money(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function dateLabel(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function differenceClass(value: number) {
  if (Math.abs(value) < 0.005) return "text-gray-500";
  return value > 0 ? "text-emerald-700" : "text-red-600";
}

function mergeRows(currentRows: ProfitLossRow[], previousRows: ProfitLossRow[]) {
  const currentByKey = new Map(currentRows.map((row) => [row.key, row]));
  const previousByKey = new Map(previousRows.map((row) => [row.key, row]));
  return Array.from(new Set([...currentByKey.keys(), ...previousByKey.keys()]))
    .map((key) => {
      const current = currentByKey.get(key);
      const previous = previousByKey.get(key);
      return {
        row: current ?? { key, label: previous?.label ?? "Account", amount: 0, details: [] },
        previousAmount: previous?.amount ?? 0,
      };
    })
    .sort((left, right) => left.row.label.localeCompare(right.row.label));
}

function ProfitLossAccountRow({
  row,
  previousAmount,
  startDate,
  endDate,
  expenseDirection = false,
}: {
  row: ProfitLossRow;
  previousAmount: number;
  startDate: string;
  endDate: string;
  expenseDirection?: boolean;
}) {
  const detailTotal = row.details.reduce((total, detail) => total + detail.amount, 0);
  const totalDebit = row.details.reduce((total, detail) => total + detail.debit, 0);
  const totalCredit = row.details.reduce((total, detail) => total + detail.credit, 0);
  const variance = detailTotal - row.amount;
  const agrees = Math.abs(variance) < 0.005;
  const difference = row.amount - previousAmount;
  const controlId = `pnl-ledger-${row.key.replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="p-0" colSpan={4}>
        <details className="group" id={controlId}>
          <summary className="grid min-w-[780px] cursor-pointer list-none grid-cols-[46%_18%_18%_18%] items-center px-4 py-3 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#c18d28] [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2 pl-4 font-medium text-gray-800">
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[#9a6b19] transition-transform group-open:rotate-90" />
              <span className="truncate">{row.label}</span>
              <span className="shrink-0 rounded-full bg-[#f8edcf] px-2 py-0.5 text-[11px] font-semibold text-[#815b13]">
                {row.details.length} {row.details.length === 1 ? "line" : "lines"}
              </span>
            </span>
            <span className="text-right tabular-nums text-gray-700">{money(row.amount)}</span>
            <span className="text-right tabular-nums text-gray-700">{money(previousAmount)}</span>
            <span className={`text-right tabular-nums font-medium ${differenceClass(expenseDirection ? -difference : difference)}`}>{money(difference)}</span>
          </summary>

          <div className="border-t border-[#d7dde5] bg-slate-50 px-4 py-4">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{row.label} · current-period supporting ledger</p>
                <p className="text-xs text-gray-600">{dateLabel(startDate)} to {dateLabel(endDate)}. Change the Reporting month above to inspect another month.</p>
              </div>
              <p className="text-xs font-medium text-gray-600">{row.details.length} source {row.details.length === 1 ? "record" : "records"}</p>
            </div>

            {row.details.length ? (
              <div className="max-h-[36rem] overflow-auto rounded-md border border-[#d7dde5] bg-white">
                <Table className="min-w-[1180px]">
                  <caption className="sr-only">{row.label} current-period supporting ledger</caption>
                  <TableHeader className="sticky top-0 z-10 bg-gray-50">
                    <TableRow>
                      <TableHead>Posting date</TableHead>
                      <TableHead>Document / reference</TableHead>
                      <TableHead>Property / room</TableHead>
                      <TableHead>Tenant / payee</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">P&amp;L amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.details.map((detail) => (
                      <TableRow key={detail.id}>
                        <TableCell className="whitespace-nowrap">{dateLabel(detail.date)}</TableCell>
                        <TableCell className="min-w-52">
                          <p className="font-medium text-gray-900">{detail.documentNumber}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{detail.sourceLabel}{detail.referenceNumber ? ` · ${detail.referenceNumber}` : ""}</p>
                        </TableCell>
                        <TableCell className="min-w-44">
                          <p>{detail.propertyName}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{detail.roomName ?? "No room assigned"}</p>
                        </TableCell>
                        <TableCell className="min-w-40">{detail.partyName ?? "—"}</TableCell>
                        <TableCell className="min-w-64">{detail.description}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{Math.abs(detail.debit) >= 0.005 ? money(detail.debit) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{Math.abs(detail.credit) >= 0.005 ? money(detail.credit) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{money(detail.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="sticky bottom-0 border-t-2 border-gray-900 bg-gray-50 font-semibold hover:bg-gray-50">
                      <TableCell colSpan={5}>Supporting ledger total</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{money(totalDebit)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{money(totalCredit)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{money(detailTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">No entries belong to the selected current period. This account appears because it had activity in the previous period.</div>
            )}

            <div className={`mt-3 flex flex-col gap-1 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between ${agrees ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
              <strong>{agrees ? "Agrees to P&L total" : "Ledger difference — review required"}</strong>
              <span className="tabular-nums">P&amp;L {money(row.amount)} · Ledger {money(detailTotal)} · Variance {money(variance)}</span>
            </div>
          </div>
        </details>
      </TableCell>
    </TableRow>
  );
}

function SectionRows({
  currentRows,
  previousRows,
  startDate,
  endDate,
  expenseDirection = false,
}: {
  currentRows: ProfitLossRow[];
  previousRows: ProfitLossRow[];
  startDate: string;
  endDate: string;
  expenseDirection?: boolean;
}) {
  return mergeRows(currentRows, previousRows).map(({ row, previousAmount }) => (
    <ProfitLossAccountRow
      endDate={endDate}
      expenseDirection={expenseDirection}
      key={row.key}
      previousAmount={previousAmount}
      row={row}
      startDate={startDate}
    />
  ));
}

export function ProfitLossStatement({
  currentReport,
  priorReport,
  startDate,
  endDate,
  propertyScope,
}: {
  currentReport: ProfitLossReport;
  priorReport: ProfitLossReport;
  startDate: string;
  endDate: string;
  propertyScope: string;
}) {
  const summaryCsvRows: Array<Array<string | number>> = [
    ["DEKEZ Profit & Loss", `${startDate} to ${endDate}`, "Accrual basis", propertyScope],
    ["Section", "Account", "Current RM", "Previous RM", "Difference RM"],
    ...mergeRows(currentReport.revenue, priorReport.revenue).map(({ row, previousAmount }) => ["Revenue", row.label, row.amount.toFixed(2), previousAmount.toFixed(2), (row.amount - previousAmount).toFixed(2)]),
    ["Revenue", "Total revenue", currentReport.totalRevenue.toFixed(2), priorReport.totalRevenue.toFixed(2), (currentReport.totalRevenue - priorReport.totalRevenue).toFixed(2)],
    ...mergeRows(currentReport.costsOfSales, priorReport.costsOfSales).map(({ row, previousAmount }) => ["Cost of sales", row.label, row.amount.toFixed(2), previousAmount.toFixed(2), (row.amount - previousAmount).toFixed(2)]),
    ["Cost of sales", "Gross profit", currentReport.grossProfit.toFixed(2), priorReport.grossProfit.toFixed(2), (currentReport.grossProfit - priorReport.grossProfit).toFixed(2)],
    ...mergeRows(currentReport.expenses, priorReport.expenses).map(({ row, previousAmount }) => ["Operating expenses", row.label, row.amount.toFixed(2), previousAmount.toFixed(2), (row.amount - previousAmount).toFixed(2)]),
    ["Operating expenses", "Total expenses", currentReport.totalExpenses.toFixed(2), priorReport.totalExpenses.toFixed(2), (currentReport.totalExpenses - priorReport.totalExpenses).toFixed(2)],
    ["Result", "Net profit / (loss)", currentReport.netProfit.toFixed(2), priorReport.netProfit.toFixed(2), (currentReport.netProfit - priorReport.netProfit).toFixed(2)],
  ];
  const ledgerCsvRows: Array<Array<string | number>> = [
    ["DEKEZ P&L Supporting Ledger", `${startDate} to ${endDate}`, propertyScope],
    ["Account", "Posting Date", "Source", "Document", "Reference", "Property", "Room", "Tenant / Payee", "Description", "Debit RM", "Credit RM", "P&L Amount RM"],
    ...[...currentReport.revenue, ...currentReport.costsOfSales, ...currentReport.expenses].flatMap((row) => row.details.map((detail) => [
      row.label,
      detail.date,
      detail.sourceLabel,
      detail.documentNumber,
      detail.referenceNumber ?? "",
      detail.propertyName,
      detail.roomName ?? "",
      detail.partyName ?? "",
      detail.description,
      detail.debit.toFixed(2),
      detail.credit.toFixed(2),
      detail.amount.toFixed(2),
    ])),
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <CardTitle>Profit &amp; Loss Statement</CardTitle>
          <CardDescription>{dateLabel(startDate)} to {dateLabel(endDate)} · accrual basis · deposits excluded from income · {propertyScope}</CardDescription>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <CsvDownloadButton fileName={`DEKEZ-profit-and-loss-${startDate}-to-${endDate}.csv`} label="Download P&L CSV" rows={summaryCsvRows} />
          <CsvDownloadButton fileName={`DEKEZ-profit-and-loss-ledger-${startDate}-to-${endDate}.csv`} label="Download detailed ledger" rows={ledgerCsvRows} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <strong>Audit breakdown:</strong> Open any account below to see every source record inside the current-period total. Each ledger is checked back to the P&amp;L figure and follows the selected month and property.
        </div>
        <Table className="min-w-[780px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[46%]">Account · open for ledger</TableHead>
              <TableHead className="w-[18%] text-right">Current period</TableHead>
              <TableHead className="w-[18%] text-right">Previous period</TableHead>
              <TableHead className="w-[18%] text-right">Difference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-emerald-50 hover:bg-emerald-50"><TableCell className="font-semibold text-emerald-900" colSpan={4}>Revenue</TableCell></TableRow>
            <SectionRows currentRows={currentReport.revenue} endDate={endDate} previousRows={priorReport.revenue} startDate={startDate} />
            <TableRow><TableCell className="font-semibold">Total revenue</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(currentReport.totalRevenue)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(priorReport.totalRevenue)}</TableCell><TableCell className={`text-right font-semibold tabular-nums ${differenceClass(currentReport.totalRevenue - priorReport.totalRevenue)}`}>{money(currentReport.totalRevenue - priorReport.totalRevenue)}</TableCell></TableRow>

            <TableRow className="bg-amber-50 hover:bg-amber-50"><TableCell className="font-semibold text-amber-900" colSpan={4}>Cost of sales / direct property costs</TableCell></TableRow>
            {currentReport.costsOfSales.length || priorReport.costsOfSales.length ? <SectionRows currentRows={currentReport.costsOfSales} endDate={endDate} expenseDirection previousRows={priorReport.costsOfSales} startDate={startDate} /> : <TableRow><TableCell className="pl-8 text-gray-500" colSpan={4}>No direct property costs recorded for either period.</TableCell></TableRow>}
            <TableRow><TableCell className="font-semibold">Gross profit</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(currentReport.grossProfit)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(priorReport.grossProfit)}</TableCell><TableCell className={`text-right font-semibold tabular-nums ${differenceClass(currentReport.grossProfit - priorReport.grossProfit)}`}>{money(currentReport.grossProfit - priorReport.grossProfit)}</TableCell></TableRow>

            <TableRow className="bg-red-50 hover:bg-red-50"><TableCell className="font-semibold text-red-900" colSpan={4}>Operating expenses</TableCell></TableRow>
            {currentReport.expenses.length || priorReport.expenses.length ? <SectionRows currentRows={currentReport.expenses} endDate={endDate} expenseDirection previousRows={priorReport.expenses} startDate={startDate} /> : <TableRow><TableCell className="pl-8 text-gray-500" colSpan={4}>No operating expenses recorded for either period.</TableCell></TableRow>}
            <TableRow><TableCell className="font-semibold">Total expenses</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(currentReport.totalExpenses)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(priorReport.totalExpenses)}</TableCell><TableCell className={`text-right font-semibold tabular-nums ${differenceClass(priorReport.totalExpenses - currentReport.totalExpenses)}`}>{money(currentReport.totalExpenses - priorReport.totalExpenses)}</TableCell></TableRow>
            <TableRow className="border-t-2 border-gray-900 bg-gray-50 text-base font-bold hover:bg-gray-50"><TableCell>Net profit / (loss)</TableCell><TableCell className="text-right tabular-nums">{money(currentReport.netProfit)}</TableCell><TableCell className="text-right tabular-nums">{money(priorReport.netProfit)}</TableCell><TableCell className={`text-right tabular-nums ${differenceClass(currentReport.netProfit - priorReport.netProfit)}`}>{money(currentReport.netProfit - priorReport.netProfit)}</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
