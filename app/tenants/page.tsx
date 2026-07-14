import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export default async function TenantsPage() {
  await requireRole(["super_admin", "owner", "admin"]);
  const supabase = await createClient();
  const [profilesResult, tenanciesResult, roomsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role")
      .eq("role", "tenant")
      .order("full_name", { ascending: true }),
    supabase
      .from("tenancies")
      .select("id, tenant_id, room_id, monthly_rental, deposit, contract_start, contract_end, due_day, status")
      .order("created_at", { ascending: false }),
    supabase
      .from("rooms")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);
  const tenants = profilesResult.data ?? [];
  const tenancies = tenanciesResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const roomById = new Map(rooms.map((room) => [room.id, room.name]));
  const tenancyByTenantId = new Map(tenancies.map((tenancy) => [tenancy.tenant_id, tenancy]));

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">People</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Tenants</h1>
        <p className="mt-2 text-sm text-gray-600">
          Real tenant profiles and tenancy assignments from Supabase.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tenant Overview</CardTitle>
          <CardDescription>Create tenants and assign rooms in Admin Setup.</CardDescription>
        </CardHeader>
        <CardContent>
          {tenants.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Monthly Rent</TableHead>
                  <TableHead>Due Day</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((tenant) => {
                  const tenancy = tenancyByTenantId.get(tenant.id);

                  return (
                    <TableRow key={tenant.id}>
                      <TableCell className="font-medium text-gray-950">{tenant.full_name ?? tenant.id}</TableCell>
                      <TableCell>{tenant.phone ?? "-"}</TableCell>
                      <TableCell>{tenancy ? roomById.get(tenancy.room_id) ?? "-" : "Not assigned"}</TableCell>
                      <TableCell>{ringgitFormatter.format(Number(tenancy?.monthly_rental ?? 0))}</TableCell>
                      <TableCell>{tenancy?.due_day ? `Day ${tenancy.due_day}` : "-"}</TableCell>
                      <TableCell><Badge>{tenancy?.status ?? "unassigned"}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No tenants yet. Create tenant accounts in Admin Setup.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
