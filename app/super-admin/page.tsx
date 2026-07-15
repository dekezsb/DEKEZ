import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

type Company = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string | null;
};

type Property = {
  id: string;
  company_id: string | null;
};

type Room = {
  id: string;
  status: string | null;
};

async function getSuperAdminSummary() {
  try {
    const admin = createAdminClient();
    const [companiesResult, propertiesResult, roomsResult] = await Promise.all([
      admin.from("companies").select("id, name, email, phone, status").order("name", { ascending: true }),
      admin.from("properties").select("id, company_id"),
      admin.from("rooms").select("id, status"),
    ]);

    return {
      error: companiesResult.error?.message ?? propertiesResult.error?.message ?? roomsResult.error?.message ?? null,
      companies: (companiesResult.data ?? []) as Company[],
      properties: (propertiesResult.data ?? []) as Property[],
      rooms: (roomsResult.data ?? []) as Room[],
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to load Super Admin data.",
      companies: [] as Company[],
      properties: [] as Property[],
      rooms: [] as Room[],
    };
  }
}

export default async function SuperAdminPage() {
  await requireRole(["super_admin"]);
  const summary = await getSuperAdminSummary();
  const occupiedRooms = summary.rooms.filter((room) => room.status === "occupied").length;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">
          Backend Control
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Super Admin
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Full platform view for DEKEZ using backend access for imported records.
        </p>
      </div>

      {summary.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {summary.error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Companies</CardDescription>
            <CardTitle className="text-2xl">{summary.companies.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total Properties</CardDescription>
            <CardTitle className="text-2xl">{summary.properties.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total Rooms</CardDescription>
            <CardTitle className="text-2xl">{summary.rooms.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Occupied Rooms</CardDescription>
            <CardTitle className="text-2xl">{occupiedRooms}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>All companies in the database.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary.companies.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium text-gray-950">{company.name}</TableCell>
                    <TableCell>{company.email ?? "-"}</TableCell>
                    <TableCell>{company.phone ?? "-"}</TableCell>
                    <TableCell>{company.status ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">
              No companies found. If you already ran the import, check that Vercel uses the same Supabase project.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
