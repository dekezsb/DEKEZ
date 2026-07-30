import { CheckCircle2, Clock3, ReceiptText } from "lucide-react";
import { ClaimBillForm } from "@/components/maintenance/claim-bill-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { formatMalaysiaDate } from "@/lib/date-format";
import { money } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{
    claim_submitted?: string;
    claim_error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Complete the description, property, amount and payment source.",
  property: "The selected property is not available.",
  room: "The selected room does not belong to that property.",
  ticket: "The selected maintenance job does not match.",
  owner: "This property needs an assigned Owner before a claim can be sent.",
  create: "The claim could not be saved.",
  receipt_type: "Attach a JPG, PNG, WebP or PDF no larger than 10 MB.",
  receipt_upload: "The receipt could not be uploaded.",
};

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function claimLabel(status: string, expenseStatus?: string | null) {
  if (expenseStatus === "paid") return "Paid";
  if (status === "approved") return "Verified";
  if (status === "information_requested") return "Information requested";
  if (status === "rejected") return "Rejected";
  return "Pending verification";
}

export default async function ClaimsPage({ searchParams }: PageProps) {
  await requireRole(["admin"], { module: "claims", level: "manage" });
  const user = await getCurrentUser();
  const params = await searchParams;
  if (!user) return null;

  const supabase = await createClient();
  const [propertiesResult, roomsResult, ticketsResult, claimsResult] =
    await Promise.all([
      supabase.from("properties").select("id, name").order("name"),
      supabase
        .from("rooms")
        .select("id, property_id, name, room_number")
        .order("room_number"),
      supabase
        .from("maintenance_tickets")
        .select("id, property_id, ticket_number, description")
        .order("created_at", { ascending: false }),
      supabase
        .from("claims")
        .select(
          "id, property_id, room_id, description, total_amount, funding_source, status, submitted_at, rejection_reason, properties(name), rooms(name, room_number)",
        )
        .eq("submitted_by", user.id)
        .order("submitted_at", { ascending: false }),
    ]);

  const claims = claimsResult.data ?? [];
  const claimIds = claims.map((claim) => claim.id);
  const [attachmentsResult, expensesResult] = claimIds.length
    ? await Promise.all([
        supabase
          .from("claim_attachments")
          .select("id, claim_id, bucket_name, file_path, content_type")
          .in("claim_id", claimIds),
        supabase
          .from("expenses")
          .select("claim_id, status")
          .in("claim_id", claimIds),
      ])
    : [{ data: [] }, { data: [] }];

  const expenseByClaim = new Map(
    (expensesResult.data ?? []).map((expense) => [
      expense.claim_id,
      expense.status,
    ]),
  );
  const attachmentsByClaim = new Map<
    string,
    {
      id: string;
      contentType: string | null;
      fileName: string;
      url: string | null;
    }[]
  >();

  for (const attachment of attachmentsResult.data ?? []) {
    const { data } = await supabase.storage
      .from(attachment.bucket_name)
      .createSignedUrl(attachment.file_path, 60 * 10);
    const list = attachmentsByClaim.get(attachment.claim_id) ?? [];
    list.push({
      id: attachment.id,
      contentType: attachment.content_type,
      fileName: attachment.file_path.split("/").at(-1) ?? "Receipt",
      url: data?.signedUrl ?? null,
    });
    attachmentsByClaim.set(attachment.claim_id, list);
  }

  const paidCount = claims.filter(
    (claim) => expenseByClaim.get(claim.id) === "paid",
  ).length;
  const pendingCount = claims.filter(
    (claim) => claim.status === "pending_owner_approval",
  ).length;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#b98a2c]">
          Management Claims
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Claim Bills</h1>
        <p className="mt-2 text-sm text-gray-600">
          Submit repair receipts and follow each claim through verification and
          payment.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock3 className="h-5 w-5 text-[#b98a2c]" />
            <div>
              <p className="text-xs text-gray-500">Pending</p>
              <p className="text-xl font-semibold">{pendingCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-xs text-gray-500">Paid</p>
              <p className="text-xl font-semibold">{paidCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {params.claim_submitted === "1" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Claim submitted successfully. It is now waiting for Admin
          verification.
        </div>
      ) : null}
      {params.claim_error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMessages[params.claim_error] ?? "The claim could not be saved."}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>New Claim</CardTitle>
          <CardDescription>
            Use company money or your own money. A receipt is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClaimBillForm
            allowUnlinkedJob
            properties={propertiesResult.data ?? []}
            returnTo="/claims"
            rooms={roomsResult.data ?? []}
            tickets={ticketsResult.data ?? []}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Claim History</CardTitle>
          <CardDescription>
            Paid claims are shown in green and remain available with their
            receipt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {claims.length ? (
            <div className="space-y-3">
              {claims.map((claim) => {
                const property = single(claim.properties);
                const room = single(claim.rooms);
                const expenseStatus = expenseByClaim.get(claim.id);
                const label = claimLabel(claim.status, expenseStatus);
                return (
                  <article
                    className={`grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto] sm:items-center ${
                      label === "Paid"
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-[#d7dde5] bg-white"
                    }`}
                    key={claim.id}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ReceiptText className="h-4 w-4 text-[#b98a2c]" />
                        <h2 className="font-semibold">{claim.description}</h2>
                        <Badge
                          className={
                            label === "Paid"
                              ? "bg-emerald-100 text-emerald-700"
                              : statusBadgeClass(claim.status)
                          }
                        >
                          {label}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-gray-600">
                        {property?.name ?? "Property"}
                        {room
                          ? ` / ${room.room_number ?? room.name ?? "Room"}`
                          : ""}
                        {" · "}
                        {money(claim.total_amount ?? 0)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {formatMalaysiaDate(claim.submitted_at)} ·{" "}
                        {claim.funding_source === "staff_personal"
                          ? "My own money"
                          : "Company money"}
                      </p>
                      {claim.rejection_reason ? (
                        <p className="mt-2 text-sm text-red-600">
                          {claim.rejection_reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      {(attachmentsByClaim.get(claim.id) ?? []).map(
                        (attachment) => (
                          <DocumentPreview
                            contentType={attachment.contentType}
                            fileName={attachment.fileName}
                            key={attachment.id}
                            label="Claim receipt"
                            showName={false}
                            size="sm"
                            url={attachment.url}
                          />
                        ),
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No claims yet. Submit one when you pay a repair bill.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
