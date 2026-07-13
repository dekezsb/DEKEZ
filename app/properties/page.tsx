import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getFirstCompany, getProperties } from "@/lib/data/organization";
import { createProperty } from "./actions";

type PropertiesPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter the property name and address.",
  create: "Property could not be saved. Please try again.",
};

export default async function PropertiesPage({ searchParams }: PropertiesPageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const [properties, company, params] = await Promise.all([
    getProperties(),
    getFirstCompany(),
    searchParams,
  ]);

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

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Property saved successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Property could not be saved."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add Property</CardTitle>
          <CardDescription>
            Create another property or location under your company.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {company ? (
            <form action={createProperty} className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Property name</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="name"
                  placeholder="Main House"
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Address/location</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="address"
                  placeholder="Kuala Lumpur"
                  required
                />
              </label>
              <label className="block lg:min-w-48">
                <span className="text-sm font-medium text-gray-700">Notes optional</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="notes"
                />
              </label>
              <Button className="lg:col-start-3" type="submit">
                Add property
              </Button>
            </form>
          ) : (
            <p className="text-sm text-gray-500">
              Complete Owner setup first before adding properties.
            </p>
          )}
        </CardContent>
      </Card>

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
