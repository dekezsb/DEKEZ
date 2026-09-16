import { ArrowRight, Droplets, Landmark, ReceiptText } from "lucide-react";
import { redirect } from "next/navigation";
import { Link } from "@/components/app-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasModuleAccess } from "@/lib/auth/access";
import { getCurrentUserAccess, requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export default async function ApPaymentVouchersPage() {
  await requireRole([
    "super_admin",
    "owner",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
  ]);
  const { access } = await getCurrentUserAccess();
  const canViewUtilities = hasModuleAccess(access, "utility_bills");
  const canViewExpenses = hasModuleAccess(access, "expenses");

  if (!canViewUtilities && !canViewExpenses) {
    redirect("/dashboard?error=access_denied");
  }

  const supabase = await createClient();
  const [utilityBillsResult, expenseBillsResult] = await Promise.all([
    canViewUtilities
      ? supabase
          .from("utility_bills")
          .select("id, amount, paid_amount")
          .eq("billing_scope", "property")
          .neq("status", "cancelled")
      : Promise.resolve({ data: [] }),
    canViewExpenses
      ? supabase
          .from("expenses")
          .select("id, amount")
          .eq("status", "verified")
          .eq("payment_status", "unpaid")
          .in("funding_source", ["company_cash", "company_bank"])
      : Promise.resolve({ data: [] }),
  ]);

  const utilityBills = utilityBillsResult.data ?? [];
  const expenseBills = expenseBillsResult.data ?? [];
  const utilityOutstanding = utilityBills.reduce(
    (total, bill) =>
      total + Math.max(Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0), 0),
    0,
  );
  const expenseOutstanding = expenseBills.reduce(
    (total, bill) => total + Number(bill.amount ?? 0),
    0,
  );

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#b98a2c]">Accounts payable</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">AP Payment Vouchers</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          Manage every company bill from one place. Utility and expense records remain separate so their receipts, approvals and payment history stay accurate.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {canViewUtilities ? (
          <Card className="border-[#b9d9d4]">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="rounded-lg bg-[#e7f4f1] p-3 text-[#126b5f]">
                  <Droplets className="h-6 w-6" />
                </div>
                <Badge className="border-[#b9d9d4] bg-[#effaf7] text-[#126b5f]">
                  {utilityBills.length} active
                </Badge>
              </div>
              <CardTitle>Property Utility Bills</CardTitle>
              <CardDescription>
                Water, electricity and other property utility payments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Outstanding amount</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">
                {ringgitFormatter.format(utilityOutstanding)}
              </p>
              <Button asChild className="mt-5 w-full" variant="outline">
                <Link href="/utility-bills">
                  Open utility bills <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {canViewExpenses ? (
          <Card className="border-[#ead7a8]">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="rounded-lg bg-[#fff7e5] p-3 text-[#9b6a10]">
                  <ReceiptText className="h-6 w-6" />
                </div>
                <Badge className="border-[#ead7a8] bg-[#fffaf0] text-[#9b6a10]">
                  {expenseBills.length} awaiting payment
                </Badge>
              </div>
              <CardTitle>Company Expense Bills</CardTitle>
              <CardDescription>
                Verified company expenses, payment batches and staff AP payouts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Awaiting payment</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">
                {ringgitFormatter.format(expenseOutstanding)}
              </p>
              <Button asChild className="mt-5 w-full" variant="outline">
                <Link href="/expenses">
                  Open expense bills <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="border-[#d7dde5] bg-[#f8fafc]">
        <CardContent className="flex items-start gap-3 p-5 text-sm text-gray-600">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-[#126b5f]" />
          <p>
            Use this as the single AP payment-voucher entry point. The original records and documents are retained, avoiding duplicate payments while keeping the audit trail complete.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
