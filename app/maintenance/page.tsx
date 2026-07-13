import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createMaintenanceTicket } from "./actions";

type MaintenancePageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter the ticket details.",
  assignment: "Tenant or room is missing. Assign a tenancy first.",
  room: "Selected room was not found.",
  create: "Maintenance ticket could not be saved.",
};

export default async function MaintenancePage({ searchParams }: MaintenancePageProps) {
  const role = await requireRole([
    "super_admin",
    "owner",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
    "tenant",
  ]);
  const params = await searchParams;
  const supabase = await createClient();
  const [ticketsResult, roomsResult, tenantsResult] = await Promise.all([
    supabase
      .from("maintenance_tickets")
      .select("id, ticket_number, ticket_type, category, description, urgency, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("rooms")
      .select("id, name")
      .order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "tenant")
      .order("full_name", { ascending: true }),
  ]);
  const tickets = ticketsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const tenants = tenantsResult.data ?? [];
  const canCreate = ["super_admin", "owner", "admin", "tenant"].includes(role);
  const isTenant = role === "tenant";

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Operations</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Maintenance</h1>
        <p className="mt-2 text-sm text-gray-600">
          Real maintenance and cleaning tickets controlled by Supabase RLS.
        </p>
      </div>

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Ticket submitted successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Ticket could not be saved."}
        </div>
      ) : null}

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Submit Ticket</CardTitle>
            <CardDescription>
              Tenants submit their own room request. Admin can create a ticket for any tenant and room.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createMaintenanceTicket} className="grid gap-4 lg:grid-cols-2">
              {!isTenant ? (
                <>
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
                    <span className="text-sm font-medium text-gray-700">Room</span>
                    <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="roomId" required>
                      <option value="">Choose room</option>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>{room.name}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Ticket type</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="ticketType" defaultValue="maintenance">
                  <option value="maintenance">Maintenance</option>
                  <option value="repair">Repair</option>
                  <option value="cleaning">Cleaning</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Urgency</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="urgency" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Category optional</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="category" placeholder="Aircond, plumbing, cleaning" />
              </label>
              <label className="block lg:col-span-2">
                <span className="text-sm font-medium text-gray-700">Description</span>
                <textarea className="mt-2 min-h-28 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="description" required />
              </label>
              <Button className="lg:col-span-2" type="submit">Submit ticket</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tickets</CardTitle>
          <CardDescription>Only tickets your role can access are shown.</CardDescription>
        </CardHeader>
        <CardContent>
          {tickets.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-medium text-gray-950">{ticket.ticket_number ?? ticket.id.slice(0, 8)}</TableCell>
                    <TableCell>{ticket.ticket_type}</TableCell>
                    <TableCell>{ticket.description}</TableCell>
                    <TableCell><Badge>{ticket.urgency}</Badge></TableCell>
                    <TableCell><Badge>{ticket.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No tickets yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
