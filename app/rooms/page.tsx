import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getProperties, getRooms } from "@/lib/data/organization";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export default async function RoomsPage() {
  await requireRole(["super_admin", "owner", "admin"]);
  const [rooms, properties] = await Promise.all([getRooms(), getProperties()]);
  const propertyById = new Map(properties.map((property) => [property.id, property.name]));

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#126b5f]">Inventory</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Rooms</h1>
          <p className="mt-2 text-sm text-gray-600">
            Live room records from Supabase.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/setup">Owner setup</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Room List</CardTitle>
          <CardDescription>Rooms, current status and base monthly rent.</CardDescription>
        </CardHeader>
        <CardContent>
          {rooms.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Monthly Rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((room) => (
                  <TableRow key={room.id}>
                    <TableCell className="font-medium text-gray-950">{room.name}</TableCell>
                    <TableCell>{propertyById.get(room.property_id) ?? "-"}</TableCell>
                    <TableCell>
                      <Badge>{room.status}</Badge>
                    </TableCell>
                    <TableCell>{ringgitFormatter.format(room.monthly_rent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">
              No rooms yet. Use Owner setup to create your first room.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
