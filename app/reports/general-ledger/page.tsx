import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CsvDownloadButton } from "@/components/accounting/csv-download-button";
import { activeAccounts, buildAccountLedger, glCsvRows, glQuery, glScopeNote, glSourceLabels, parseGlParams } from "@/lib/accounting/general-ledger";
import { loadGeneralLedger } from "@/lib/accounting/general-ledger-data";
import { voucherPageContext } from "@/lib/accounting/voucher-page-data";

type SearchParams = Promise<Record<string, string | undefined>>;
const money = (value: number) => value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function GeneralLedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseGlParams(await searchParams);
  const { company, supabase } = await voucherPageContext();
  const { accounts, lines } = params.error ? { accounts: [], lines: [] } : await loadGeneralLedger(supabase, company.id, params.to);
  const selected = accounts.find((account) => account.id === params.account);
  const ledgers = params.error ? [] : selected ? [buildAccountLedger(selected, lines, params.from, params.to)] : activeAccounts(accounts, lines, params.from, params.to);
  const query = glQuery(params);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline" href="/reports?tab=journal"><ArrowLeft className="h-4 w-4" />Accounts &amp; Reports</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-950">General Ledger</h1>
          <p className="text-sm text-gray-600">Every account with its opening balance, running balance and a link from each line to the document it came from.</p>
        </div>
        {ledgers.length ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={`/reports/general-ledger/print?${query}`} target="_blank"><Printer className="h-4 w-4" />Print / PDF</Link></Button>
            <CsvDownloadButton fileName={`DEKEZ-general-ledger-${params.from}-to-${params.to}.csv`} label="Export CSV" rows={glCsvRows(ledgers)} />
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>{glScopeNote}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-4" method="get">
            <label className="text-sm sm:col-span-2">Account
              <select className="mt-1 block h-10 w-full rounded-md border border-[#d7dde5] bg-white px-2" defaultValue={params.account} name="account">
                <option value="">All accounts with activity</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} {account.name}</option>)}
              </select>
            </label>
            <label className="text-sm">From<input className="mt-1 block h-10 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={params.from} name="from" type="date" /></label>
            <label className="text-sm">To<input className="mt-1 block h-10 w-full rounded-md border border-[#d7dde5] px-2" defaultValue={params.to} name="to" type="date" /></label>
            <div className="sm:col-span-4"><Button type="submit">Show ledger</Button></div>
          </form>
          {params.error ? <p className="mt-3 text-sm text-red-700">{params.error}</p> : null}
        </CardContent>
      </Card>

      {!params.error && !ledgers.length ? <p className="rounded-md border bg-white p-4 text-sm text-gray-600">No movement or opening balance for this selection.</p> : null}

      {ledgers.map((ledger) => (
        <Card key={ledger.account.id}>
          <CardHeader>
            <CardTitle className="text-lg">{ledger.account.code} {ledger.account.name}</CardTitle>
            <CardDescription>{params.from} to {params.to} · {ledger.account.normalBalance}-normal account · {ledger.rows.length} lines</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-gray-500"><th className="py-2">Date</th><th>Source</th><th>No.</th><th>Other no.</th><th>Party / description</th><th>Property</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                <tr className="border-b bg-gray-50 font-medium"><td className="py-2" colSpan={8}>Opening balance</td><td className="text-right">{money(ledger.opening)}</td></tr>
                {ledger.rows.map((row) => (
                  <tr className="border-b align-top" key={row.key}>
                    <td className="py-2 whitespace-nowrap">{row.date}</td>
                    <td><Badge variant="neutral">{glSourceLabels[row.source]}</Badge></td>
                    <td className="font-mono text-xs">{row.href ? <Link className="text-blue-700 underline" href={row.href}>{row.number}</Link> : row.number}</td>
                    <td className="font-mono text-xs text-gray-600">{row.aliasNumber ?? ""}</td>
                    <td>{[row.party, row.description].filter(Boolean).join(" · ")}{row.reference ? <span className="block text-xs text-gray-500">Ref {row.reference}</span> : null}</td>
                    <td>{row.property}</td>
                    <td className="text-right">{row.debit ? money(row.debit) : ""}</td>
                    <td className="text-right">{row.credit ? money(row.credit) : ""}</td>
                    <td className="text-right font-medium">{money(row.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold"><td className="py-2" colSpan={6}>Closing balance</td><td className="text-right">{money(ledger.totalDebit)}</td><td className="text-right">{money(ledger.totalCredit)}</td><td className="text-right">{money(ledger.closing)}</td></tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
