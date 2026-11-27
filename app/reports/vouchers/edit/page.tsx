import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { voidVoucher } from "@/app/reports/voucher-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VoucherForm } from "@/components/accounting/voucher-form";
import { loadVoucherAudit, loadVoucherForEdit } from "@/lib/accounting/voucher-data";
import { voucherPageContext } from "@/lib/accounting/voucher-page-data";
import { journalEditability, printHref, voucherErrorMessages, voucherTypeLabels } from "@/lib/accounting/vouchers";

type SearchParams = Promise<Record<string, string | undefined>>;
const money = (value: number) => `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const actionLabels: Record<string, string> = {
  voucher_posted: "Posted", voucher_amended: "Edited (auto reversal + corrected entry)", voucher_voided: "Voided (auto reversal)",
  journal_adopted_as_voucher: "Registered for editing", bank_voucher_amended: "Edited (reversing rows + corrected lines)",
  bank_voucher_voided: "Voided (reversing rows, bank line re-opened)", payment_voucher_created: "Recorded from bank reconciliation",
};

function auditTotals(before: unknown, after: unknown) {
  const total = (value: unknown) => {
    const record = (value ?? {}) as Record<string, unknown>;
    const amount = record.total_amount ?? record.total;
    return amount == null ? null : Number(amount);
  };
  const beforeTotal = total(before);
  const afterTotal = total(after);
  if (beforeTotal == null || afterTotal == null) return null;
  return <p className="text-xs text-gray-500">Before {money(beforeTotal)} → after {money(afterTotal)}</p>;
}

export default async function EditVoucherPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const kind = params.kind === "bank" || params.kind === "journal" ? params.kind : "voucher";
  const id = params.id ?? "";
  const { company, supabase, accounts, paymentAccounts, properties, banks } = await voucherPageContext();
  const back = <Link className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline" href="/reports/vouchers"><ArrowLeft className="h-4 w-4" />Voucher Register</Link>;

  // Journals created by other modules: explain where to correct them.
  if (kind === "journal") {
    const { data: entry } = await supabase.from("accounting_journal_entries").select("id, entry_number, source_type, description").eq("company_id", company.id).eq("id", id).maybeSingle();
    const { data: voucherRow } = await supabase.from("accounting_vouchers").select("id").eq("journal_entry_id", id).maybeSingle();
    const editability = journalEditability(entry?.source_type ?? "");
    if (entry && !voucherRow && !editability.editable) {
      const { data: renovation } = entry.source_type.startsWith("renovation")
        ? await supabase.from("renovation_documents").select("id").eq("journal_entry_id", id).maybeSingle()
        : { data: null };
      return (
        <div className="space-y-4">{back}
          <Card><CardHeader><CardTitle>{entry.entry_number}</CardTitle><CardDescription>{entry.description}</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm"><p>{editability.reason}</p>
              {renovation ? <Button asChild><Link href={`/renovation/${renovation.id}`}>Open the renovation invoice</Link></Button> : null}
            </CardContent></Card>
        </div>
      );
    }
  }

  const model = await loadVoucherForEdit(supabase, company.id, kind, id);
  if (!model) return <div className="space-y-4">{back}<p className="rounded-md bg-gray-50 px-4 py-6 text-sm text-gray-600">This voucher could not be found.</p></div>;
  const audit = await loadVoucherAudit(supabase, company.id, model);
  const error = params.error ? voucherErrorMessages[params.error] ?? voucherErrorMessages.voucher_failed : "";
  const posted = model.status === "posted";
  const formKind = model.kind;
  const bankName = banks.find((bank) => bank.id === model.bankAccountId)?.name;

  return (
    <div className="space-y-5">
      {back}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950">{voucherTypeLabels[model.type]} {model.number}</h1>
          <p className="text-sm text-gray-600">{model.sourceLabel} · revision {model.revision} · {money(model.total)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={posted ? (model.revision > 1 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800") : "bg-red-100 text-red-800"}>{posted ? (model.revision > 1 ? `Amended (rev ${model.revision})` : "Posted") : "Voided"}</Badge>
          <Button asChild variant="outline"><Link href={printHref({ kind: formKind, id: model.id })} target="_blank"><Printer className="h-4 w-4" />Print / PDF</Link></Button>
        </div>
      </div>
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      {model.sourceLabel === "Checkout deposit settlement" ? <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This journal was posted at a tenant checkout. Editing it corrects the accounts only; the tenancy and deposit record on the tenant page are not changed.</div> : null}

      {posted ? (
        <Card>
          <CardHeader><CardTitle>Edit</CardTitle><CardDescription>Change anything and save. The old entry is reversed automatically and the corrected one is posted under the same number; you never need to type a reversing journal yourself.</CardDescription></CardHeader>
          <CardContent>
            <VoucherForm accounts={accounts} bankAccountName={bankName} id={model.id} initial={{ date: model.date, party: model.party, propertyId: model.propertyId, paymentAccountId: model.paymentAccountId, reference: model.reference, description: model.description, lines: model.lines }} kind={formKind} lockedTotal={model.lockedTotal ? model.total : 0} mode="edit" paymentAccounts={paymentAccounts} properties={properties} type={model.type} />
          </CardContent>
        </Card>
      ) : <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">This voucher is voided. It stays in the register and audit trail but no longer affects the accounts.</div>}

      {posted ? (
        <Card>
          <CardHeader><CardTitle>Void / delete</CardTitle><CardDescription>Cancels this {voucherTypeLabels[model.type].toLowerCase()} by posting an automatic reversal. The number is never reused and the record stays visible as Voided.</CardDescription></CardHeader>
          <CardContent>
            <form action={voidVoucher} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input name="kind" type="hidden" value={formKind} /><input name="id" type="hidden" value={model.id} />
              <label className="flex-1 text-sm font-medium text-gray-700">Reason for voiding
                <input className="mt-1 h-10 w-full rounded-md border border-[#d7dde5] px-3 text-sm" maxLength={500} minLength={5} name="reason" placeholder="e.g. Keyed twice by mistake" required />
              </label>
              <Button type="submit" variant="destructive">Void this voucher</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Audit trail</CardTitle><CardDescription>Who changed what, when and why.</CardDescription></CardHeader>
        <CardContent>
          {audit.length ? (
            <ul className="space-y-2 text-sm">
              {audit.map((item) => (
                <li className="rounded-md border border-[#e3e8ef] px-3 py-2" key={item.id}>
                  <p><strong>{actionLabels[item.action] ?? item.action.replaceAll("_", " ")}</strong> · {new Date(item.performed_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT · {item.performedByName}</p>
                  {item.reason ? <p className="text-gray-600">Reason: {item.reason}</p> : null}
                  {auditTotals(item.before_data, item.after_data)}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-500">No changes recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
