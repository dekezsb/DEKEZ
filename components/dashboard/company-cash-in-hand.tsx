import {
  Banknote,
  Building2,
  Landmark,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { cancelCashBankIn, recordCashBankIn } from "@/app/dashboard/cash-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashManagementSummary } from "@/lib/data/cash-management";
import { malaysiaDateString } from "@/lib/data/rent-due";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

function money(value: number) {
  return ringgitFormatter.format(value);
}

const errors: Record<string, string> = {
  missing: "Enter the company, date, amount, and a reference or note.",
  company: "You cannot record a bank-in for that company.",
  amount: "The bank-in amount is higher than the available company cash.",
  duplicate: "This bank-in reference has already been recorded for the company.",
  save: "The bank-in record could not be saved.",
  cancel_reason: "Enter a reason before cancelling a bank-in.",
  cancel: "The bank-in record could not be cancelled.",
};

export function CompanyCashInHand({
  summary,
  cashError,
  cashSaved,
  cashCancelled,
}: {
  summary: CashManagementSummary;
  cashError?: string;
  cashSaved?: boolean;
  cashCancelled?: boolean;
}) {
  return (
    <Card className="mx-auto max-w-4xl">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Company Cash in Hand</CardTitle>
            <CardDescription className="mt-2 max-w-2xl leading-6">
              Verified cash collected from tenants, minus approved company-cash expenses and completed bank-ins. Online transfers stay in the bank and are not counted here.
            </CardDescription>
          </div>
          <details className="group">
            <summary className="list-none">
              <Button asChild className="cursor-pointer bg-[#b98a2c] text-white hover:bg-[#9d7424]">
                <span>
                  <Landmark className="h-4 w-4" />
                  Record bank-in
                </span>
              </Button>
            </summary>
            <div className="mt-4 w-full rounded-lg border border-[#d7dde5] bg-[#f8fafc] p-4 sm:w-[360px]">
              <form action={recordCashBankIn} className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Company</span>
                  <select className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2" name="companyId" required>
                    <option value="">Choose company</option>
                    {summary.companies.map((company) => (
                      <option key={company.companyId} value={company.companyId}>
                        {company.companyName} - {money(company.cashInHand)} available
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Bank-in date</span>
                    <input className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2" defaultValue={malaysiaDateString()} name="bankedOn" required type="date" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Amount RM</span>
                    <input className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2" min="0.01" name="amount" required step="0.01" type="number" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Bank name</span>
                  <input className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2" name="bankName" placeholder="e.g. Public Bank" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Bank-in reference</span>
                  <input className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2" name="referenceNumber" placeholder="Receipt or transaction number" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Notes</span>
                  <textarea className="mt-1 min-h-20 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2" name="notes" />
                </label>
                <Button className="w-full bg-[#126b5f] text-white hover:bg-[#0d574d]" type="submit">
                  Confirm bank-in
                </Button>
              </form>
            </div>
          </details>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {cashError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {errors[cashError] ?? "The cash record could not be saved."}
          </p>
        ) : null}
        {cashSaved ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            Bank-in recorded successfully.
          </p>
        ) : null}
        {cashCancelled ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Bank-in cancelled. The amount has returned to cash in hand.
          </p>
        ) : null}

        <div>
          <p className="text-sm text-[#496386]">Cash still to bank</p>
          <p className="mt-1 text-3xl font-bold text-[#07142f]">{money(summary.cashInHand)}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CashMetric icon={Banknote} label="Cash collected" value={summary.cashCollected} tone="green" />
          <CashMetric icon={ReceiptText} label="Paid out of cash" value={summary.paidOutOfCash} />
          <CashMetric icon={Landmark} label="Banked in" value={summary.bankedIn} />
          <CashMetric icon={WalletCards} label="Owed to staff" value={summary.owedToStaff} tone="amber" />
        </div>

        {summary.companies.length > 1 ? (
          <div className="space-y-2 border-t border-[#e3e8ef] pt-5">
            <h3 className="text-sm font-semibold text-[#07142f]">Cash by company</h3>
            {summary.companies.map((company) => (
              <div className="grid gap-2 rounded-md border border-[#e3e8ef] px-3 py-3 text-sm sm:grid-cols-[1fr_auto]" key={company.companyId}>
                <p className="flex items-center gap-2 font-medium text-[#214066]">
                  <Building2 className="h-4 w-4" />
                  {company.companyName}
                </p>
                <p className="font-semibold text-[#07142f]">{money(company.cashInHand)} to bank</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="border-t border-[#e3e8ef] pt-5">
          <h3 className="text-sm font-semibold text-[#07142f]">Recent bank-ins</h3>
          <div className="mt-3 space-y-3">
            {summary.bankIns.map((bankIn) => (
              <details className="rounded-md border border-[#e3e8ef] bg-white p-3" key={bankIn.id}>
                <summary className="grid cursor-pointer list-none gap-2 text-sm sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-semibold text-[#07142f]">{bankIn.companyName} - {money(bankIn.amount)}</p>
                    <p className="mt-1 text-[#496386]">
                      {bankIn.bankedOn} - {bankIn.bankName ?? "Bank not specified"} - {bankIn.referenceNumber ?? "No reference"}
                    </p>
                  </div>
                  <Badge className={bankIn.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-700"}>
                    {bankIn.status}
                  </Badge>
                </summary>
                <div className="mt-3 border-t border-[#e3e8ef] pt-3 text-sm text-[#496386]">
                  <p>Recorded by {bankIn.recordedByName}</p>
                  <p>Notes: {bankIn.notes ?? "-"}</p>
                  {bankIn.status === "cancelled" ? (
                    <p className="mt-1 text-red-700">Cancelled: {bankIn.cancellationReason}</p>
                  ) : (
                    <form action={cancelCashBankIn} className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input name="bankInId" type="hidden" value={bankIn.id} />
                      <input className="min-w-0 flex-1 rounded-md border border-[#d7dde5] px-3 py-2" name="reason" placeholder="Cancellation reason" required />
                      <Button className="border-red-200 text-red-700 hover:bg-red-50" type="submit" variant="outline">
                        Cancel bank-in
                      </Button>
                    </form>
                  )}
                </div>
              </details>
            ))}
            {!summary.bankIns.length ? (
              <p className="text-sm text-[#496386]">No bank-ins recorded yet.</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CashMetric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof Banknote;
  label: string;
  value: number;
  tone?: "neutral" | "green" | "amber";
}) {
  const toneClass = tone === "green"
    ? "bg-emerald-50 text-emerald-800"
    : tone === "amber"
      ? "bg-amber-50 text-amber-900"
      : "bg-[#f4f6f8] text-[#07142f]";

  return (
    <div className={`rounded-md p-4 ${toneClass}`}>
      <Icon className="h-5 w-5" />
      <p className="mt-3 text-xs font-medium uppercase">{label}</p>
      <p className="mt-1 text-lg font-bold">{money(value)}</p>
    </div>
  );
}
