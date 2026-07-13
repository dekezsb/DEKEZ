import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { maintenance } from "@/lib/dummy-data";
import { requireRole } from "@/lib/auth/session";

export default async function MaintenancePage() {
  await requireRole(["super_admin", "owner", "admin", "technician", "tenant"]);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Operations</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Maintenance</h1>
        <p className="mt-2 text-sm text-gray-600">Dummy repair request queue for Phase 1.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Repair Requests</CardTitle>
          <CardDescription>Sample repair jobs and statuses.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maintenance.map((item) => (
                <TableRow key={item.title}>
                  <TableCell className="font-medium text-gray-950">{item.title}</TableCell>
                  <TableCell>{item.room}</TableCell>
                  <TableCell>{item.priority}</TableCell>
                  <TableCell>
                    <Badge>{item.status}</Badge>
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
