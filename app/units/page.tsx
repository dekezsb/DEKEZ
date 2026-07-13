import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function UnitsPage() {
  await requireRole(["super_admin", "owner", "admin"]);
  const supabase = await createClient();
  const { data: units } = await supabase
    .from("units")
    .select("id, name, floor, notes")
    .order("created_at", { ascending: false });

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Portfolio</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">My Units</h1>
        <p className="mt-2 text-sm text-gray-600">
          Units visible to your role through Supabase RLS.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Units</CardTitle>
          <CardDescription>Unit records under your allowed properties.</CardDescription>
        </CardHeader>
        <CardContent>
          {units?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Floor</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((unit) => (
                  <TableRow key={unit.id}>
                    <TableCell className="font-medium text-gray-950">{unit.name}</TableCell>
                    <TableCell>{unit.floor ?? "-"}</TableCell>
                    <TableCell>{unit.notes ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No units yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
