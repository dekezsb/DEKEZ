import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getProperties, getRooms } from "@/lib/data/organization";
import { createRoom } from "./actions";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type RoomsPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter the room name.",
  property: "Please choose a property first.",
  create: "Room could not be saved. Please try again.",
};

export default async function RoomsPage({ searchParams }: RoomsPageProps) {
  await requireRole(["super_admin", "owner", "admin"]);
  const [rooms, properties, params] = await Promise.all([
    getRooms(),
    getProperties(),
    searchParams,
  ]);
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

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Room saved successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Room could not be saved."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add Room</CardTitle>
          <CardDescription>Create a room under one of your properties.</CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length ? (
            <form action={createRoom} className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Property</span>
                <select
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="propertyId"
                  required
                >
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Room name/number</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="name"
                  placeholder="Room 102"
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Status</span>
                <select
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="status"
                  defaultValue="vacant"
                >
                  <option value="vacant">Vacant</option>
                  <option value="occupied">Occupied</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="reserved">Reserved</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Monthly rent RM</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-gray-950 outline-none focus:border-[#126b5f] focus:ring-2 focus:ring-[#126b5f]/20"
                  name="monthlyRent"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
              </label>
              <Button className="lg:col-start-4" type="submit">
                Add room
              </Button>
            </form>
          ) : (
            <p className="text-sm text-gray-500">
              Add a property first before creating rooms.
            </p>
          )}
        </CardContent>
      </Card>

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
                  <TableHead>Notes</TableHead>
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
                    <TableCell className="max-w-sm text-xs text-gray-500">{room.description ?? "-"}</TableCell>
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
