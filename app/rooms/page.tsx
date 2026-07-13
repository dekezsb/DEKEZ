import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rooms } from "@/lib/dummy-data";
import { requireRole } from "@/lib/auth/session";

export default async function RoomsPage() {
  await requireRole(["owner", "admin"]);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Inventory</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Rooms</h1>
        <p className="mt-2 text-sm text-gray-600">Dummy room status board for Phase 1.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Room List</CardTitle>
          <CardDescription>Sample room records and current statuses.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((room) => (
                <TableRow key={room.room}>
                  <TableCell className="font-medium text-gray-950">{room.room}</TableCell>
                  <TableCell>{room.property}</TableCell>
                  <TableCell>{room.tenant}</TableCell>
                  <TableCell>
                    <Badge>{room.status}</Badge>
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
