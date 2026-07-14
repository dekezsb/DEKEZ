import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createPayment } from "./actions";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type PaymentsPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please choose a tenant, category and amount.",
  create: "Payment could not be saved.",
};

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);
  const params = await searchParams;
  const supabase = await createClient();
  const [paymentsResult, profilesResult, tenanciesResult] = await Promise.all([
    supabase
      .from("payments")
      .select("id, tenant_id, category, amount, payment_date, payment_method, reference_number, status")
      .order("payment_date", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("role", "tenant")
      .order("full_name", { ascending: true }),
    supabase
      .from("tenancies")
      .select("id, tenant_id, room_id, monthly_rental, status")
      .order("created_at", { ascending: false }),
  ]);
  const payments = paymentsResult.data ?? [];
  const tenants = profilesResult.data ?? [];
  const tenancies = tenanciesResult.data ?? [];
  const canCreate = ["super_admin", "owner", "admin"].includes(role);
  const profileById = new Map(tenants.map((tenant) => [tenant.id, tenant.full_name ?? tenant.id]));

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Collections</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Payments</h1>
        <p className="mt-2 text-sm text-gray-600">
          Real payment records from Supabase.
        </p>
      </div>

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Payment saved successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Payment could not be saved."}
        </div>
      ) : null}

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Add Payment</CardTitle>
            <CardDescription>Record rent, deposit, utility or other tenant collection.</CardDescription>
          </CardHeader>
          <CardContent>
            {tenants.length ? (
              <form action={createPayment} className="grid gap-4 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Tenant</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="tenantId" required>
                    <option value="">Choose tenant</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>{tenant.full_name ?? tenant.id}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Tenancy optional</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="tenancyId">
                    <option value="">Auto active tenancy</option>
                    {tenancies.map((tenancy) => (
                      <option key={tenancy.id} value={tenancy.id}>
                        {profileById.get(tenancy.tenant_id) ?? "Tenant"} - {tenancy.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Category</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="category" defaultValue="monthly_rent">
                    <option value="monthly_rent">Monthly rent</option>
                    <option value="deposit">Deposit</option>
                    <option value="utility">Utility</option>
                    <option value="late_charge">Late charge</option>
                    <option value="top_up">Top up</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Amount RM</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="amount" type="number" min="0" step="0.01" required />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Payment date</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paymentDate" type="date" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Method</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="paymentMethod" defaultValue="cash">
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="duitnow">DuitNow</option>
                    <option value="online_payment">Online payment</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Reference</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="referenceNumber" />
                </label>
                <label className="block lg:col-span-2">
                  <span className="text-sm font-medium text-gray-700">Notes</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="notes" />
                </label>
                <Button className="lg:col-span-3" type="submit">Save payment</Button>
              </form>
            ) : (
              <p className="text-sm text-gray-500">Create a tenant profile first in Admin Setup.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payment Records</CardTitle>
          <CardDescription>Only payments allowed by your role are shown.</CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{payment.payment_date ?? "-"}</TableCell>
                    <TableCell className="font-medium text-gray-950">{profileById.get(payment.tenant_id ?? "") ?? "-"}</TableCell>
                    <TableCell>{payment.category}</TableCell>
                    <TableCell>{ringgitFormatter.format(Number(payment.amount ?? 0))}</TableCell>
                    <TableCell>{payment.payment_method}</TableCell>
                    <TableCell><Badge>{payment.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No payments yet. Add your first payment above.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
