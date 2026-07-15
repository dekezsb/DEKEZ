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
import { reviewPaymentSubmission } from "./actions";

type PageProps = {
  searchParams: Promise<{
    reviewed?: string;
    error?: string;
    status?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Choose a payment and action.",
  review: "Payment could not be updated.",
};

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export default async function PaymentVerificationPage({ searchParams }: PageProps) {
  await requireRole(["super_admin", "admin"]);
  const params = await searchParams;
  const supabase = await getAdmin();
  const statusFilter = params.status || "pending_verification";

  let query = supabase
    .from("payment_submissions")
    .select("id, tenant_id, tenant_application_id, tenancy_id, rent_bill_id, property_id, room_id, bill_month, bill_type, payment_type, amount, payment_date, payment_method, reference_number, receipt_url, verification_status, created_at, rejection_reason, properties(name), rooms(name, room_number), rent_bills(bill_month, due_date, amount, status)")
    .order("created_at", { ascending: false });

  if (statusFilter !== "all") {
    query = query.eq("verification_status", statusFilter);
  }

  const [submissionsResult, profilesResult] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name, phone"),
  ]);

  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const submissions = submissionsResult.data ?? [];
  const signedUrls = new Map<string, string>();

  for (const submission of submissions) {
    if (submission.receipt_url) {
      const { data } = await supabase.storage.from("payment-receipts").createSignedUrl(submission.receipt_url, 60 * 10);
      if (data?.signedUrl) {
        signedUrls.set(submission.id, data.signedUrl);
      }
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Admin Review</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Payment Verification</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Verify tenant uploaded receipts before payment is counted as paid.
        </p>
      </div>

      {params.reviewed === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Payment submission updated.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Unable to update payment submission."}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant={statusFilter === "pending_verification" ? "default" : "outline"}><Link href="/payment-verification?status=pending_verification">Pending verification</Link></Button>
        <Button asChild size="sm" variant={statusFilter === "verified" ? "default" : "outline"}><Link href="/payment-verification?status=verified">Verified</Link></Button>
        <Button asChild size="sm" variant={statusFilter === "rejected" ? "default" : "outline"}><Link href="/payment-verification?status=rejected">Rejected</Link></Button>
        <Button asChild size="sm" variant={statusFilter === "all" ? "default" : "outline"}><Link href="/payment-verification?status=all">All</Link></Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verification Queue</CardTitle>
          <CardDescription>For monthly rent, every submission is linked to a specific rent bill.</CardDescription>
        </CardHeader>
        <CardContent>
          {submissions.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Bill</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((submission) => {
                    const tenant = profiles.get(submission.tenant_id);
                    const property = Array.isArray(submission.properties) ? submission.properties[0] : submission.properties;
                    const room = Array.isArray(submission.rooms) ? submission.rooms[0] : submission.rooms;
                    const bill = Array.isArray(submission.rent_bills) ? submission.rent_bills[0] : submission.rent_bills;
                    const signedUrl = signedUrls.get(submission.id);

                    return (
                      <TableRow key={submission.id}>
                        <TableCell className="min-w-48 font-medium text-gray-950">{tenant?.full_name ?? submission.tenant_id}</TableCell>
                        <TableCell>{property?.name ?? "-"}</TableCell>
                        <TableCell>{room?.room_number ?? room?.name ?? "-"}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p>{submission.bill_type}</p>
                            <p className="text-xs text-gray-500">{bill?.bill_month ?? submission.bill_month ?? "-"}</p>
                          </div>
                        </TableCell>
                        <TableCell>{money(bill?.amount ?? submission.amount)}</TableCell>
                        <TableCell>{money(submission.amount)}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p>{submission.payment_method}</p>
                            <p className="text-xs text-gray-500">{submission.reference_number ?? "-"}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {signedUrl ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={signedUrl} target="_blank">View slip</Link>
                            </Button>
                          ) : "-"}
                        </TableCell>
                        <TableCell><Badge className={statusBadgeClass(submission.verification_status)}>{submission.verification_status}</Badge></TableCell>
                        <TableCell className="min-w-64">
                          <form action={reviewPaymentSubmission} className="space-y-2">
                            <input name="submissionId" type="hidden" value={submission.id} />
                            <textarea className="min-h-16 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" name="notes" placeholder="Reason if rejected or more info" defaultValue={submission.rejection_reason ?? ""} />
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
            <p className="text-sm text-gray-500">No payment submissions for this filter.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
