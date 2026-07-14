import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createTenant } from "./actions";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type TenantsPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
    message?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter tenant name, email and temporary password.",
  service_key: "Missing Supabase service role key. Add SUPABASE_SERVICE_ROLE_KEY in Vercel first.",
  create: "Tenant account could not be created.",
};

export default async function TenantsPage({ searchParams }: TenantsPageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const params = await searchParams;
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

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Tenant account created successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Tenant account could not be created."}
          {params.message ? ` ${params.message}` : ""}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add Tenant</CardTitle>
          <CardDescription>
            Create a tenant login first. You can assign the room and tenancy after this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createTenant} className="grid gap-4 lg:grid-cols-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Full name</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="fullName" required />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Email</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="email" type="email" required />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Phone</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="phone" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Temporary password</span>
              <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="password" type="password" required />
            </label>
            <Button className="lg:col-span-4" type="submit">Create tenant</Button>
          </form>
        </CardContent>
      </Card>

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
