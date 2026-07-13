import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { tenants } from "@/lib/dummy-data";
import { requireRole } from "@/lib/auth/session";

export default async function TenantsPage() {
  await requireRole(["super_admin", "owner", "admin"]);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">People</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Tenants</h1>
        <p className="mt-2 text-sm text-gray-600">Dummy tenant list for Phase 1.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tenant Overview</CardTitle>
          <CardDescription>Sample tenants and balances.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.name}>
                  <TableCell className="font-medium text-gray-950">{tenant.name}</TableCell>
                  <TableCell>{tenant.room}</TableCell>
                  <TableCell>{tenant.balance}</TableCell>
                  <TableCell>
                    <Badge>{tenant.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
