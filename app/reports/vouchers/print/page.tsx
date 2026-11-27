import { PrintButton } from "@/components/accounting/print-button";
import { reportCompany } from "@/lib/accounting/financial-report-export";
import { loadVoucherForEdit, loadVoucherRegister } from "@/lib/accounting/voucher-data";
import { voucherPageContext } from "@/lib/accounting/voucher-page-data";
import { amountInWords, filterRegister, statusLabel, voucherTypeLabels } from "@/lib/accounting/vouchers";

type SearchParams = Promise<Record<string, string | undefined>>;
const money = (value: number) => value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PrintVoucherPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { company, supabase, accounts, paymentAccounts, properties, banks } = await voucherPageContext();
  const header = reportCompany(company);
  const accountName = new Map([...accounts, ...paymentAccounts].map((account) => [account.id, `${account.code} ${account.name}`]));
  const propertyName = new Map(properties.map((property) => [property.id, property.name]));
  const companyHeader = (
    <div className="border-b-2 border-gray-900 pb-3 text-center">
      <p className="text-xl font-bold">{header.name}</p>
      {header.registration ? <p className="text-xs">({header.registration})</p> : null}
      {header.address ? <p className="text-xs">{header.address}</p> : null}
    </div>
  );

  if (params.list) {
    const rows = filterRegister(await loadVoucherRegister(supabase, company.id), { type: params.type, status: params.status, from: params.from, to: params.to, property: params.property, q: params.q });
    return (
      <div className="mx-auto max-w-5xl space-y-4 bg-white p-6 text-sm text-gray-900">
        <div className="flex justify-end"><PrintButton /></div>
        {companyHeader}
        <p className="text-center text-lg font-semibold">VOUCHER REGISTER</p>
        <p className="text-center text-xs">{params.from || "Beginning"} to {params.to || "today"}{params.type ? ` · ${params.type}` : ""}{params.status ? ` · ${params.status}` : ""}</p>
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-gray-900 text-left"><th className="py-1">No.</th><th>Date</th><th>Type</th><th>Payee / payer / description</th><th className="text-right">Amount (RM)</th><th>Status</th></tr></thead>
          <tbody>{rows.map((row) => <tr className="border-b border-gray-200 align-top" key={row.key}><td className="py-1 font-mono">{row.number}{row.aliasNumber ? <span className="block text-[10px] text-gray-500">{row.aliasNumber}</span> : null}</td><td>{row.date}</td><td>{row.type}</td><td>{[row.party, row.description].filter(Boolean).join(" · ")}</td><td className="text-right">{money(row.amount)}</td><td>{statusLabel(row)}</td></tr>)}</tbody>
        </table>
        <p className="text-right text-xs text-gray-500">Printed {new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT · {rows.length} documents</p>
      </div>
    );
  }

  const model = await loadVoucherForEdit(supabase, company.id, params.kind ?? "voucher", params.id ?? "");
  if (!model) return <p className="p-6 text-sm">Voucher not found.</p>;
  const isJournal = model.type === "JV";
  const bankName = model.kind === "bank" ? banks.find((bank) => bank.id === model.bankAccountId)?.name ?? "Company bank" : model.paymentAccountId ? accountName.get(model.paymentAccountId) ?? "" : "";
  return (
    <div className="mx-auto max-w-4xl space-y-4 bg-white p-6 text-sm text-gray-900">
      <div className="flex justify-end"><PrintButton /></div>
      {companyHeader}
      <div className="flex items-start justify-between">
        <p className="text-lg font-bold uppercase">{voucherTypeLabels[model.type]}</p>
        <div className="text-right text-xs">
          <p><strong>No:</strong> {model.number}{model.revision > 1 ? ` (rev ${model.revision})` : ""}</p>
          <p><strong>Date:</strong> {model.date}</p>
          {model.reference ? <p><strong>Ref:</strong> {model.reference}</p> : null}
          {model.status === "voided" ? <p className="font-bold text-red-700">VOIDED</p> : null}
        </div>
      </div>
      {!isJournal ? <p><strong>{model.type === "RV" ? "Received from" : "Pay to"}:</strong> {model.party} {bankName ? <span className="ml-4"><strong>{model.type === "RV" ? "Into" : "From"}:</strong> {bankName}</span> : null}</p> : null}
      {model.description ? <p><strong>Being:</strong> {model.description}</p> : null}
      <table className="w-full border-collapse text-xs">
        <thead><tr className="border-y border-gray-900 text-left"><th className="py-1">Account</th><th>Property</th><th>Description</th>{isJournal ? <><th className="text-right">Debit</th><th className="text-right">Credit</th></> : <th className="text-right">Amount (RM)</th>}</tr></thead>
        <tbody>
          {model.lines.map((line, index) => (
            <tr className="border-b border-gray-200" key={index}>
              <td className="py-1">{accountName.get(line.accountId) ?? ""}</td>
              <td>{line.propertyId && line.propertyId !== "office" ? propertyName.get(line.propertyId) ?? "" : "General"}</td>
              <td>{line.description}</td>
              {isJournal ? <><td className="text-right">{line.debit ? money(Number(line.debit)) : ""}</td><td className="text-right">{line.credit ? money(Number(line.credit)) : ""}</td></> : <td className="text-right">{money(Number(line.amount ?? 0))}</td>}
            </tr>
          ))}
          <tr className="border-t-2 border-gray-900 font-bold"><td className="py-1" colSpan={3}>TOTAL</td>{isJournal ? <><td className="text-right">{money(model.total)}</td><td className="text-right">{money(model.total)}</td></> : <td className="text-right">{money(model.total)}</td>}</tr>
        </tbody>
      </table>
      {!isJournal ? <p className="text-xs"><strong>Amount in words:</strong> {amountInWords(model.total)}</p> : null}
      <div className="grid grid-cols-3 gap-6 pt-12 text-center text-xs">
        <div className="border-t border-gray-900 pt-1">Prepared by</div>
        <div className="border-t border-gray-900 pt-1">Approved by</div>
        <div className="border-t border-gray-900 pt-1">{model.type === "RV" ? "Received by" : isJournal ? "Checked by" : "Received by (payee)"}</div>
      </div>
    </div>
  );
}
