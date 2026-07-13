import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { properties } from "@/lib/dummy-data";
import { requireRole } from "@/lib/auth/session";

export default async function PropertiesPage() {
  await requireRole(["owner", "admin"]);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Portfolio</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Properties</h1>
        <p className="mt-2 text-sm text-gray-600">Dummy property overview for Phase 1.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Managed Properties</CardTitle>
          <CardDescription>Sample locations and occupancy.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Rooms</TableHead>
                <TableHead>Occupancy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((property) => (
                <TableRow key={property.name}>
                  <TableCell className="font-medium text-gray-950">{property.name}</TableCell>
                  <TableCell>{property.location}</TableCell>
                  <TableCell>{property.rooms}</TableCell>
                  <TableCell>
                    <Badge>{property.occupancy}</Badge>
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
