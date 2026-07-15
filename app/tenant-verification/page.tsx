import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { money } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { reviewTenantApplication } from "./actions";

type PageProps = {
  searchParams: Promise<{
    reviewed?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Choose an application and action.",
  review: "Application could not be updated.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export default async function TenantVerificationPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "admin"]);
  const params = await searchParams;
  const supabase = await getAdmin();

  const [applicationsResult, documentsResult] = await Promise.all([
    supabase
      .from("tenant_applications")
      .select("id, tenant_id, full_name, ic_passport_number, whatsapp_number, property_id, room_id, monthly_rent, deposit, contract_duration_months, verification_status, payment_status, status, submitted_at, admin_notes, properties(name), rooms(name, room_number)")
      .order("submitted_at", { ascending: false }),
    supabase
      .from("tenant_documents")
      .select("id, tenant_application_id, document_type, file_path, file_name, verification_status"),
  ]);

  const documentsByApplication = new Map<string, { id: string; document_type: string; file_path: string; file_name: string | null; verification_status: string; signedUrl?: string }[]>();

  for (const document of documentsResult.data ?? []) {
    const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(document.file_path, 60 * 10);
    const list = documentsByApplication.get(document.tenant_application_id) ?? [];
    list.push({ ...document, signedUrl: data?.signedUrl });
    documentsByApplication.set(document.tenant_application_id, list);
  }

  const applications = applicationsResult.data ?? [];

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Admin Review</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Tenant Verification</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Review tenant identity, private documents, property selection, room selection, rent, deposit and duration.
        </p>
      </div>

      {params.reviewed === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Tenant application updated.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Unable to update tenant application."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>Owner does not automatically see IC documents here. This page is for Admin/Super Admin review.</CardDescription>
        </CardHeader>
        <CardContent>
          {applications.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>IC / Passport</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Rent</TableHead>
                    <TableHead>Deposit</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((application) => {
                    const property = Array.isArray(application.properties) ? application.properties[0] : application.properties;
                    const room = Array.isArray(application.rooms) ? application.rooms[0] : application.rooms;
                    const documents = documentsByApplication.get(application.id) ?? [];

                    return (
                      <TableRow key={application.id}>
                        <TableCell className="min-w-48 font-medium text-gray-950">{application.full_name}</TableCell>
                        <TableCell>{application.whatsapp_number ?? "-"}</TableCell>
                        <TableCell>{application.ic_passport_number ?? "-"}</TableCell>
                        <TableCell>{property?.name ?? "-"}</TableCell>
                        <TableCell>{room?.room_number ?? room?.name ?? "-"}</TableCell>
                        <TableCell>{money(application.monthly_rent)}</TableCell>
                        <TableCell>{money(application.deposit)}</TableCell>
                        <TableCell>{application.contract_duration_months} months</TableCell>
                        <TableCell className="min-w-52">
                          <div className="flex flex-wrap gap-2">
                            {documents.map((document) => (
                              document.signedUrl ? (
                                <Button asChild key={document.id} size="sm" variant="outline">
                                  <Link href={document.signedUrl} target="_blank">{document.document_type}</Link>
                                </Button>
                              ) : (
                                <Badge key={document.id}>{document.document_type}</Badge>
                              )
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge className={statusBadgeClass(application.verification_status)}>{application.verification_status}</Badge>
                            <Badge className={statusBadgeClass(application.payment_status)}>{application.payment_status}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-64">
                          <form action={reviewTenantApplication} className="space-y-2">
                            <input name="applicationId" type="hidden" value={application.id} />
                            <textarea className="min-h-16 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" name="notes" placeholder="Notes optional" defaultValue={application.admin_notes ?? ""} />
                            <div className="grid gap-2 sm:grid-cols-3">
                              <Button name="decision" size="sm" type="submit" value="verified">Verify</Button>
                              <Button name="decision" size="sm" type="submit" value="more_information_required" variant="outline">More info</Button>
                              <Button className="border-red-200 text-red-700 hover:bg-red-50" name="decision" size="sm" type="submit" value="rejected" variant="outline">Reject</Button>
                            </div>
                          </form>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No tenant applications yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
