import { FileBarChart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

function money(value: number) {
  return ringgitFormatter.format(value);
}

function sum<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

export default async function ReportsPage() {
  await requireRole(["super_admin", "owner", "admin"]);
  const supabase = await createClient();
  const [paymentsResult, utilityBillsResult, claimsResult, rentBillsResult, roomsResult] = await Promise.all([
    supabase.from("payments").select("amount, category, status"),
    supabase.from("utility_bills").select("utility_type, amount, paid_amount, status"),
    supabase.from("claims").select("status, total_amount, labour_cost, material_cost"),
    supabase.from("rent_bills").select("amount, paid_amount, status"),
    supabase.from("rooms").select("status, monthly_rent"),
  ]);
  const payments = paymentsResult.data ?? [];
  const utilityBills = utilityBillsResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const rentBills = rentBillsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const income = sum(payments.filter((payment) => payment.status !== "cancelled"), "amount");
  const waterBills = sum(utilityBills.filter((bill) => bill.utility_type === "water"), "amount");
  const electricityBills = sum(utilityBills.filter((bill) => bill.utility_type === "electricity"), "amount");
  const approvedClaims = claims.filter((claim) => claim.status === "approved");
  const claimExpenses = approvedClaims.reduce(
    (total, claim) =>
      total +
      Number(claim.total_amount ?? Number(claim.labour_cost ?? 0) + Number(claim.material_cost ?? 0)),
    0,
  );
  const totalExpenses = waterBills + electricityBills + claimExpenses;
  const outstandingRent = sum(rentBills, "amount") - sum(rentBills, "paid_amount");
  const expectedRent = sum(rooms, "monthly_rent");

  const reportCards = [
    { title: "Monthly income", value: money(income), detail: "Confirmed non-cancelled payments" },
    { title: "Monthly expenses", value: money(totalExpenses), detail: "Utilities plus approved claims" },
    { title: "Net cash flow", value: money(income - totalExpenses), detail: "Income minus paid out items" },
    { title: "Expected rental", value: money(expectedRent), detail: "Room rent setup total" },
    { title: "Outstanding rental", value: money(outstandingRent), detail: "Rent billed minus paid" },
    { title: "Water bills", value: money(waterBills), detail: "Water utility amount" },
    { title: "Electricity bills", value: money(electricityBills), detail: "Electricity utility amount" },
    { title: "Maintenance claims", value: money(claimExpenses), detail: "Approved claim amount" },
  ];

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Insights</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Reports</h1>
        <p className="mt-2 text-sm text-gray-600">
          Real cash-flow summaries from your Supabase records.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {reportCards.map((report) => (
          <Card key={report.title}>
            <CardHeader>
              <FileBarChart className="h-5 w-5 text-[#126b5f]" />
              <CardDescription>{report.title}</CardDescription>
              <CardTitle className="text-2xl">{report.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">{report.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
