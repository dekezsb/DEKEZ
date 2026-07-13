import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createUtilityBill } from "./actions";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type UtilityBillsPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please choose a room, bill type, bill month and amount.",
  room: "Selected room was not found.",
  create: "Utility bill could not be saved.",
};

export default async function UtilityBillsPage({ searchParams }: UtilityBillsPageProps) {
  const role = await requireRole(["super_admin", "owner", "admin", "tenant"]);
  const params = await searchParams;
  const supabase = await createClient();
  const [billsResult, roomsResult] = await Promise.all([
    supabase
      .from("utility_bills")
      .select("id, utility_type, bill_month, amount, paid_amount, status, notes")
      .order("bill_month", { ascending: false }),
    supabase
      .from("rooms")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);
  const bills = billsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const canCreate = ["super_admin", "owner", "admin"].includes(role);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Utilities</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Utility Bills</h1>
        <p className="mt-2 text-sm text-gray-600">
          Water and electricity bills visible to your role.
        </p>
      </div>
      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Utility bill saved successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Utility bill could not be saved."}
        </div>
      ) : null}
      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Add Utility Bill</CardTitle>
            <CardDescription>Create water, electricity or other utility charges for a room.</CardDescription>
          </CardHeader>
          <CardContent>
            {rooms.length ? (
              <form action={createUtilityBill} className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Room</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="roomId" required>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>{room.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Type</span>
                  <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="utilityType" defaultValue="water">
                    <option value="water">Water</option>
                    <option value="electricity">Electricity</option>
                    <option value="internet">Internet</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Bill month</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="billMonth" type="month" required />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Amount RM</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="amount" type="number" min="0" step="0.01" required />
                </label>
                <label className="block lg:col-span-4">
                  <span className="text-sm font-medium text-gray-700">Notes optional</span>
                  <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="notes" />
                </label>
                <Button className="lg:col-start-5" type="submit">Add bill</Button>
              </form>
            ) : (
              <p className="text-sm text-gray-500">Create a room first before adding utility bills.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Bills</CardTitle>
          <CardDescription>RLS controls which bills appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          {bills.length ? (
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
