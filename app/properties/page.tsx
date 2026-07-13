import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getProperties } from "@/lib/data/organization";

export default async function PropertiesPage() {
  await requireRole(["super_admin", "owner", "admin"]);
  const properties = await getProperties();

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#126b5f]">Portfolio</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Properties</h1>
          <p className="mt-2 text-sm text-gray-600">
            Live property records from Supabase.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/setup">Owner setup</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Managed Properties</CardTitle>
          <CardDescription>Your visible company property list.</CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((property) => (
                  <TableRow key={property.id}>
                    <TableCell className="font-medium text-gray-950">{property.name}</TableCell>
                    <TableCell>{property.address}</TableCell>
                    <TableCell>{property.notes ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">
              No properties yet. Use Owner setup to create your first property.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
