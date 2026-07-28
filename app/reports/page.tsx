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
  const [paymentsResult, utilityBillsResult, claimsResult, rentBillsResult, roomsResult, expensesResult, propertiesResult] = await Promise.all([
    supabase.from("payments").select("property_id, amount, category, status"),
    supabase
      .from("utility_bills")
      .select("property_id, utility_type, amount, paid_amount, status")
      .eq("billing_scope", "property"),
    supabase.from("claims").select("property_id, status, total_amount, labour_cost, material_cost"),
    supabase.from("rent_bills").select("amount, paid_amount, status"),
    supabase.from("rooms").select("status, monthly_rent, property_id"),
    supabase.from("expenses").select("property_id, amount, charge_to, status, tax_claimable, claim_id"),
    supabase.from("properties").select("id, name"),
  ]);
  const payments = paymentsResult.data ?? [];
  const utilityBills = utilityBillsResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const rentBills = rentBillsResult.data ?? [];
  const activeRentBills = rentBills.filter(
    (bill) => !["draft", "cancelled", "waived"].includes(String(bill.status)),
  );
  const rooms = roomsResult.data ?? [];
  const expenses = expensesResult.data ?? [];
  const properties = propertiesResult.data ?? [];
  const income = sum(payments.filter((payment) => payment.status !== "cancelled"), "amount");
  const activeUtilityBills = utilityBills.filter((bill) => bill.status !== "cancelled");
  const waterBills = sum(activeUtilityBills.filter((bill) => bill.utility_type === "water"), "amount");
  const electricityBills = sum(activeUtilityBills.filter((bill) => bill.utility_type === "electricity"), "amount");
  const utilityPayments = sum(activeUtilityBills, "paid_amount");
  const approvedClaims = claims.filter((claim) => claim.status === "approved");
  const claimExpenses = approvedClaims.reduce(
    (total, claim) =>
      total +
      Number(claim.total_amount ?? Number(claim.labour_cost ?? 0) + Number(claim.material_cost ?? 0)),
    0,
  );
  const verifiedStandaloneExpenses = expenses.filter((expense) => expense.status === "verified" && !expense.claim_id);
  const expenseBills = sum(verifiedStandaloneExpenses, "amount");
  const ownerChargeExpenses = sum(
    verifiedStandaloneExpenses.filter((expense) => expense.charge_to === "owner"),
    "amount",
  );
  const companyChargeExpenses = sum(
    verifiedStandaloneExpenses.filter((expense) => expense.charge_to === "company"),
    "amount",
  );
  const tenantChargeExpenses = sum(
    verifiedStandaloneExpenses.filter((expense) => expense.charge_to === "tenant"),
    "amount",
  );
  const taxClaimableExpenses = sum(
    verifiedStandaloneExpenses.filter((expense) => expense.tax_claimable),
    "amount",
  );
  const totalExpenses = utilityPayments + claimExpenses + expenseBills;
  const outstandingRent =
    sum(activeRentBills, "amount") - sum(activeRentBills, "paid_amount");
  const expectedRent = sum(rooms, "monthly_rent");

  const reportCards = [
    { title: "Monthly income", value: money(income), detail: "Confirmed non-cancelled payments" },
    { title: "Monthly expenses", value: money(totalExpenses), detail: "Paid utilities, verified expenses and approved claims" },
    { title: "Net cash flow", value: money(income - totalExpenses), detail: "Income minus paid out items" },
    { title: "Expense bills", value: money(expenseBills), detail: "Verified expenses not already linked to claims" },
    { title: "Owner charge expenses", value: money(ownerChargeExpenses), detail: "Verified property expenses charged to owners" },
    { title: "Company expenses", value: money(companyChargeExpenses), detail: "Verified company-paid expenses" },
    { title: "Tenant charge expenses", value: money(tenantChargeExpenses), detail: "Prepared tenant-charge expenses" },
    { title: "Tax claimable", value: money(taxClaimableExpenses), detail: "Verified tax-claimable expense bills" },
    { title: "Expected rental", value: money(expectedRent), detail: "Room rent setup total" },
    { title: "Outstanding rental", value: money(outstandingRent), detail: "Rent billed minus paid" },
    { title: "Water bills", value: money(waterBills), detail: "Water utility amount" },
    { title: "Electricity bills", value: money(electricityBills), detail: "Electricity utility amount" },
    { title: "Maintenance claims", value: money(claimExpenses), detail: "Approved claim amount" },
  ];
  const propertyReports = properties.map((property) => {
    const propertyIncome = sum(
      payments.filter((payment) => payment.status !== "cancelled" && payment.property_id === property.id),
      "amount",
    );
    const propertyExpenses = sum(
      verifiedStandaloneExpenses.filter((expense) => expense.property_id === property.id),
      "amount",
    );
    const propertyClaimExpenses = claims
      .filter((claim) => claim.status === "approved" && claim.property_id === property.id)
      .reduce(
        (total, claim) =>
          total +
          Number(claim.total_amount ?? Number(claim.labour_cost ?? 0) + Number(claim.material_cost ?? 0)),
        0,
      );
    const propertyUtilityPayments = sum(
      activeUtilityBills.filter((bill) => bill.property_id === property.id),
      "paid_amount",
    );

    return {
      id: property.id,
      name: property.name,
      income: propertyIncome,
      expenses: propertyExpenses,
      utilities: propertyUtilityPayments,
      claims: propertyClaimExpenses,
      net: propertyIncome - propertyExpenses - propertyUtilityPayments - propertyClaimExpenses,
    };
  });

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
      <Card>
        <CardHeader>
          <CardTitle>Property Net Income Snapshot</CardTitle>
          <CardDescription>
            Rental collected + other income - verified property expenses - approved owner claims.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {propertyReports.map((property) => (
            <div className="grid gap-2 rounded-lg border border-[#d7dde5] bg-white p-4 text-sm sm:grid-cols-[1fr_auto]" key={property.id}>
              <div>
                <p className="font-semibold text-gray-950">{property.name}</p>
                <p className="text-gray-500">
                  Income {money(property.income)} - expenses {money(property.expenses)} - utilities {money(property.utilities)} - claims {money(property.claims)}
                </p>
              </div>
              <p className="font-semibold text-[#126b5f]">{money(property.net)}</p>
            </div>
          ))}
          {!propertyReports.length ? (
            <p className="text-sm text-gray-500">No property reports yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
