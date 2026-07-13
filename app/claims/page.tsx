import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export default async function ClaimsPage() {
  await requireRole([
    "super_admin",
    "owner",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
  ]);
  const supabase = await createClient();
  const { data: claims } = await supabase
    .from("claims")
    .select("id, labour_cost, material_cost, total_amount, description, status, submitted_at")
    .order("submitted_at", { ascending: false });

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Claims</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Claims</h1>
        <p className="mt-2 text-sm text-gray-600">
          Claim records visible to owners, admins, and assigned staff.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Claim Requests</CardTitle>
          <CardDescription>Pending approvals, approved claims and rejected claims.</CardDescription>
        </CardHeader>
        <CardContent>
          {claims?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Labour</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((claim) => {
                  const total =
                    claim.total_amount ??
                    Number(claim.labour_cost ?? 0) + Number(claim.material_cost ?? 0);

                  return (
                    <TableRow key={claim.id}>
                      <TableCell>{claim.submitted_at ? new Date(claim.submitted_at).toLocaleDateString("en-MY") : "-"}</TableCell>
                      <TableCell className="font-medium text-gray-950">{claim.description ?? "-"}</TableCell>
                      <TableCell>{ringgitFormatter.format(Number(claim.labour_cost ?? 0))}</TableCell>
                      <TableCell>{ringgitFormatter.format(Number(claim.material_cost ?? 0))}</TableCell>
                      <TableCell>{ringgitFormatter.format(Number(total ?? 0))}</TableCell>
                      <TableCell><Badge>{claim.status}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-gray-500">No claims yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
