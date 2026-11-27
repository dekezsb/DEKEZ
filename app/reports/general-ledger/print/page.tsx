import { PrintButton } from "@/components/accounting/print-button";
import { reportCompany } from "@/lib/accounting/financial-report-export";
import { activeAccounts, buildAccountLedger, glScopeNote, glSourceLabels, parseGlParams } from "@/lib/accounting/general-ledger";
import { loadGeneralLedger } from "@/lib/accounting/general-ledger-data";
import { voucherPageContext } from "@/lib/accounting/voucher-page-data";

type SearchParams = Promise<Record<string, string | undefined>>;
const money = (value: number) => value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PrintGeneralLedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseGlParams(await searchParams);
  const { company, supabase } = await voucherPageContext();
  if (params.error) return <p className="p-6 text-sm">{params.error}</p>;
  const header = reportCompany(company);
  const { accounts, lines } = await loadGeneralLedger(supabase, company.id, params.to);
  const selected = accounts.find((account) => account.id === params.account);
  const ledgers = selected ? [buildAccountLedger(selected, lines, params.from, params.to)] : activeAccounts(accounts, lines, params.from, params.to);
  return (
    <div className="mx-auto max-w-5xl space-y-6 bg-white p-6 text-sm text-gray-900">
      <div className="flex justify-end print:hidden"><PrintButton /></div>
      <div className="border-b-2 border-gray-900 pb-3 text-center">
        <p className="text-xl font-bold">{header.name}</p>
        {header.registration ? <p className="text-xs">({header.registration})</p> : null}
        {header.address ? <p className="text-xs">{header.address}</p> : null}
      </div>
      <p className="text-center text-lg font-semibold">GENERAL LEDGER</p>
      <p className="text-center text-xs">{params.from} to {params.to}{selected ? ` · ${selected.code} ${selected.name}` : " · all accounts with activity"}</p>
      {ledgers.map((ledger) => (
        <section className="break-inside-avoid-page" key={ledger.account.id}>
          <p className="border-b border-gray-900 pb-1 font-semibold">{ledger.account.code} {ledger.account.name}</p>
          <table className="w-full border-collapse text-[11px]">
            <thead><tr className="border-b text-left"><th className="py-1">Date</th><th>Source</th><th>No.</th><th>Other no.</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              <tr className="font-medium"><td className="py-1" colSpan={7}>Opening balance</td><td className="text-right">{money(ledger.opening)}</td></tr>
              {ledger.rows.map((row) => (
                <tr className="border-b border-gray-200 align-top" key={row.key}>
                  <td className="py-1 whitespace-nowrap">{row.date}</td><td>{glSourceLabels[row.source]}</td>
                  <td className="font-mono">{row.number}</td><td className="font-mono text-gray-600">{row.aliasNumber ?? ""}</td>
                  <td>{[row.party, row.description].filter(Boolean).join(" · ")}{row.property && row.property !== "General" ? ` (${row.property})` : ""}</td>
                  <td className="text-right">{row.debit ? money(row.debit) : ""}</td><td className="text-right">{row.credit ? money(row.credit) : ""}</td><td className="text-right">{money(row.balance)}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-900 font-semibold"><td className="py-1" colSpan={5}>Closing balance</td><td className="text-right">{money(ledger.totalDebit)}</td><td className="text-right">{money(ledger.totalCredit)}</td><td className="text-right">{money(ledger.closing)}</td></tr>
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-[10px] text-gray-500">{glScopeNote}</p>
      <p className="text-right text-xs text-gray-500">Printed {new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT</p>
    </div>
  );
}
