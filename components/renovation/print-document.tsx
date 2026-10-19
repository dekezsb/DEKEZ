import { BrandLogo } from "@/components/brand-logo";
import { invoiceDate, ringgitInWords } from "@/lib/invoices/format";
import { lineCents, money, stageAmounts, totalCents, type RenovationDocument } from "@/lib/renovation/model";

function Letterhead() {
  return <header className="flex items-center justify-center gap-6 border-b border-slate-200 pb-5"><BrandLogo size={76} /><div className="text-center"><h2 className="text-xl font-bold">DEKEZ SDN BHD</h2><p className="text-xs">202501054747 (1656153-U)</p><p className="mt-2 text-xs">Lot 30, Kian Yap Industrial Estate, Lorong Durian 3,<br />Kota Kinabalu, Sabah, Malaysia<br />Tel: +6016-8173911 · TIN: C60479177010</p></div></header>;
}
export function RenovationPrintDocument({ document: d, payments }: { document: RenovationDocument; payments?: { verified: number; outstanding: number } }) {
  const amounts = stageAmounts(Math.round(Number(d.total) * 100), d.stages);
  const cell = "border border-black px-2 py-2 align-top";
  return <article className="renovation-print mx-auto max-w-[210mm] bg-white p-8 text-black shadow-sm print:p-0 print:shadow-none">
    <style>{`@media print { @page { size: A4; margin: 14mm; } .renovation-print { font-size: 10pt; max-width: none; } .renovation-print tr { break-inside: avoid; } .renovation-print thead { display: table-header-group; } .renovation-terms { break-before: page; } .renovation-keep { break-inside: avoid; } }`}</style>
    <Letterhead /><h1 className="my-5 text-center text-2xl font-bold uppercase">{d.kind === "quotation" ? "Quotation" : "Invoice"}</h1>
    {d.status === "draft" && <p className="mb-3 border-2 border-amber-600 p-2 text-center font-bold">DRAFT — NOT ISSUED</p>}
    {d.status === "superseded" && <p className="mb-3 border-2 border-red-600 p-2 text-center font-bold">SUPERSEDED — DO NOT ACCEPT OR PAY</p>}
    <div className="mb-5 grid grid-cols-2 gap-3 text-sm"><div><p className="font-semibold">CLIENT / ATTENTION: {d.client_snapshot.name}</p><p className="whitespace-pre-line">{d.client_snapshot.address}</p><p>{d.client_snapshot.phone}</p><p>{d.client_snapshot.email}</p></div><div className="text-right"><p>{d.document_number ?? "Number assigned on issue"}</p><p>Date: {invoiceDate(d.document_date)}</p><p>{d.kind === "quotation" ? "Valid until" : "Due date"}: {invoiceDate(d.due_date)}</p></div></div>
    <p className="font-semibold">PROJECT: {d.project}</p><p className="mb-4 whitespace-pre-line text-sm">{d.site_address}</p>
    <p className="mb-4 font-semibold">TOTAL CONTRACT SUM: {money(Number(d.total))}</p>
    <table className="w-full table-fixed border-collapse text-xs"><colgroup><col className="w-[5%]" /><col className="w-[45%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[14%]" /><col className="w-[16%]" /></colgroup><thead><tr>{["NO.", "DESCRIPTION", "QTY", "UNIT", "UNIT PRICE (RM)", "AMOUNT (RM)"].map(label => <th key={label} className={`${cell} bg-slate-50`}>{label}</th>)}</tr></thead><tbody>{d.items.map((line, i) => <tr key={i}><td className={cell}>{i + 1}</td><td className={`${cell} whitespace-pre-line break-words`}>{line.description}</td><td className={`${cell} text-right`}>{line.quantity}</td><td className={`${cell} break-words`}>{line.unit}</td><td className={`${cell} text-right`}>{Number(line.rate).toFixed(2)}</td><td className={`${cell} text-right`}>{(lineCents(line) / 100).toFixed(2)}</td></tr>)}</tbody></table>
    <section className="renovation-keep mt-5 space-y-2"><p className="text-right">Subtotal: {money(totalCents(d.items) / 100)}</p><p className="text-right">Discount{d.discount_kind === "percent" ? ` (${d.discount_value}%)` : ""}: −{money(Number(d.discount_amount))}</p><p className="text-right text-lg font-bold">TOTAL {d.kind.toUpperCase()}: {money(Number(d.total))}</p><p className="text-xs font-semibold uppercase">{ringgitInWords(Number(d.total))}</p>
      <h3 className="pt-4 font-semibold">PAYMENT TERMS</h3><table className="w-full border-collapse text-xs"><thead><tr><th className={cell}>STAGE</th><th className={cell}>%</th><th className={cell}>AMOUNT</th></tr></thead><tbody>{d.stages.map((stage, i) => <tr key={i}><td className={cell}>{stage.label}</td><td className={cell}>{stage.percent}%</td><td className={`${cell} text-right`}>{money(amounts[i])}</td></tr>)}</tbody></table>
      {payments && <div className="space-y-1 text-right"><p>Verified payments received: {money(payments.verified)}</p><p className="font-bold">Outstanding: {money(payments.outstanding)}</p></div>}
      {d.kind === "invoice" && <p className="text-xs">Only verified payments are reflected above. Please quote {d.document_number ?? "the invoice number"} when paying.</p>}
    </section>
    <section className="renovation-terms mt-12"><Letterhead /><h3 className="mt-8 font-semibold">TERMS & CONDITIONS</h3><ol className="mt-4 list-decimal space-y-3 pl-5 text-xs">{d.terms.split("\n").filter(Boolean).map((term, i) => <li key={i} className="break-words">{term}</li>)}</ol>
      <div className="renovation-keep mt-7 text-sm"><h3 className="font-semibold">{d.kind === "quotation" ? "ACCEPTANCE" : "PAYMENT DETAILS"}</h3>
        {d.kind === "quotation" && <p className="mt-3">If the scope and payment terms are acceptable, kindly sign and return this quotation. The first payment stage is {money(amounts[0] ?? 0)}.</p>}
        <p className="mt-4">Bank: Public Bank Berhad<br />Account Name: DEKEZ SDN. BHD.<br />Account No.: 3247421720</p>
        <p className="mt-3">Work and material preparation will commence upon confirmation and receipt of the agreed down payment.</p>
        <div className="mt-8 grid grid-cols-2 gap-10 text-xs"><div><p>PREPARED BY: DEKEZ SDN. BHD.</p><p className="mt-12">Signature: __________________</p><p className="mt-3">Name: _____________________</p><p className="mt-3">Date: ______________________</p></div><div><p>{d.kind === "quotation" ? "ACCEPTED BY" : "CLIENT"}: {d.client_snapshot.name}</p>{d.kind === "quotation" && <><p className="mt-12">Signature: __________________</p><p className="mt-3">Name: _____________________</p><p className="mt-3">Date: ______________________</p></>}</div></div>
      </div>
    </section>
  </article>;
}
