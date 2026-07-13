import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getDashboardSummary } from "@/lib/data/organization";

export default async function SuperAdminPage() {
  await requireRole(["super_admin"]);
  const summary = await getDashboardSummary();

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
          Full platform view for DEKEZ. This page is hidden from the public first page and protected by Supabase role metadata.
        </p>
      </div>

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
            <CardTitle className="text-2xl">{summary.totalProperties}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total Rooms</CardDescription>
            <CardTitle className="text-2xl">{summary.totalRooms}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Occupied Rooms</CardDescription>
            <CardTitle className="text-2xl">{summary.occupiedRooms}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>All companies visible to the Super Admin role.</CardDescription>
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
                    <TableCell>{company.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No companies have been created yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
