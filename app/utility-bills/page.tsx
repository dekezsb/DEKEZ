import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export default async function UtilityBillsPage() {
  await requireRole(["super_admin", "owner", "admin", "tenant"]);
  const supabase = await createClient();
  const { data: bills } = await supabase
    .from("utility_bills")
    .select("id, utility_type, bill_month, amount, paid_amount, status, notes")
    .order("bill_month", { ascending: false });

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Utilities</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Utility Bills</h1>
        <p className="mt-2 text-sm text-gray-600">
          Water and electricity bills visible to your role.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Bills</CardTitle>
          <CardDescription>RLS controls which bills appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          {bills?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell className="font-medium text-gray-950">{bill.utility_type}</TableCell>
                    <TableCell>{bill.bill_month ?? "-"}</TableCell>
                    <TableCell>{ringgitFormatter.format(Number(bill.amount ?? 0))}</TableCell>
                    <TableCell>{ringgitFormatter.format(Number(bill.paid_amount ?? 0))}</TableCell>
                    <TableCell><Badge>{bill.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No utility bills yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
