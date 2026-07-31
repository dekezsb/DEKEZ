import { Badge } from "@/components/ui/badge";
import { ClaimBillForm } from "@/components/maintenance/claim-bill-form";
import { TenantMaintenance } from "@/components/tenant/tenant-portal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreview } from "@/components/ui/document-preview";
import { requireRole } from "@/lib/auth/session";
import { getTenantPortalData } from "@/lib/data/tenant-portal";
import { formatMalaysiaDate } from "@/lib/date-format";
import { money } from "@/lib/e-tenancy";
import { statusBadgeClass } from "@/lib/status-styles";
import { createClient } from "@/lib/supabase/server";
import {
  createMaintenanceTicket,
  updateMaintenanceTicketStatus,
} from "./actions";

type MaintenancePageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
    claim_submitted?: string;
    claim_error?: string;
    updated?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  missing: "Please enter the ticket details.",
  assignment: "Tenant or room is missing. Assign a tenancy first.",
  room: "Selected room was not found.",
  create: "Maintenance ticket could not be saved.",
  photo_type: "Use a JPG, PNG or WebP photo no larger than 10 MB.",
  photo_upload: "The report was saved, but the photo could not be uploaded.",
  status: "The maintenance status could not be updated.",
  ticket: "The maintenance ticket is no longer available.",
  completion_photo: "Upload a completion photo before marking the job Resolved.",
};

const claimErrorMessages: Record<string, string> = {
  missing: "Complete the claim description, property, amount and payment source.",
  property: "The selected property is not available to your account.",
  room: "The selected room does not belong to that property.",
  ticket: "The selected maintenance job does not match the property or room.",
  owner: "Assign an Owner to this property before submitting a claim.",
  create: "The claim could not be saved.",
  receipt_type: "Attach a JPG, PNG, WebP or PDF receipt no larger than 10 MB.",
  receipt_upload: "The receipt could not be uploaded. No claim was submitted.",
};

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function claimStatusLabel(status: string) {
  if (status === "pending_owner_approval") return "Pending verification";
  if (status === "approved") return "Verified";
  if (status === "information_requested") return "Information requested";
  return status.replaceAll("_", " ");
}

const urgencyOrder: Record<string, number> = {
  urgent: 0,
  normal: 1,
  low: 2,
};

function urgencyLabel(urgency: string | null) {
  if (urgency === "urgent") return "Urgent";
  if (urgency === "low") return "Low";
  return "Normal";
}

function urgencyBadgeClass(urgency: string | null) {
  if (urgency === "urgent") return "border-red-200 bg-red-100 text-red-700";
  if (urgency === "low") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-amber-200 bg-amber-100 text-amber-800";
}

function ticketStatusLabel(status: string) {
  if (status === "completed") return "Resolved";
  if (status === "in_progress") return "In Progress";
  return "Open";
}

export default async function MaintenancePage({ searchParams }: MaintenancePageProps) {
  const role = await requireRole([
    "super_admin",
    "owner",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
    "tenant",
  ]);
  const params = await searchParams;

  if (role === "tenant") {
    const data = await getTenantPortalData();
    return data ? (
      <TenantMaintenance
        created={params.created === "1"}
        data={data}
        error={
          params.error
            ? (errorMessages[params.error] ?? "The report could not be saved.")
            : undefined
        }
      />
    ) : null;
  }

  const supabase = await createClient();
  const [
    ticketsResult,
    roomsResult,
    tenantsResult,
    propertiesResult,
    claimsResult,
  ] = await Promise.all([
    supabase
      .from("maintenance_tickets")
      .select("id, property_id, room_id, ticket_number, ticket_type, category, description, urgency, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("rooms")
      .select("id, property_id, name, room_number")
      .order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "tenant")
      .order("full_name", { ascending: true }),
    supabase.from("properties").select("id, name").order("name"),
    supabase
      .from("claims")
      .select("id, property_id, room_id, ticket_id, description, total_amount, funding_source, status, submitted_at, rejection_reason, properties(name), rooms(name, room_number)")
      .order("submitted_at", { ascending: false }),
  ]);
  const tickets = ticketsResult.data ?? [];
  const rooms = roomsResult.data ?? [];
  const tenants = tenantsResult.data ?? [];
  const properties = propertiesResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const canCreate = ["super_admin", "owner"].includes(role);
  const canSubmitClaim = [
    "super_admin",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
  ].includes(role);
  const canSubmitUnlinkedClaim = ["super_admin", "admin"].includes(role);
  const canUpdateTicket = [
    "super_admin",
    "admin",
    "technician",
    "maintenance_staff",
    "cleaning_staff",
  ].includes(role);

  const [{ data: ticketAttachments }, { data: claimAttachments }] = await Promise.all([
    tickets.length
      ? supabase
          .from("maintenance_attachments")
          .select("id, ticket_id, attachment_type, bucket_name, file_path, content_type, created_at")
          .in(
            "ticket_id",
            tickets.map((ticket) => ticket.id),
          )
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    claims.length
      ? supabase
          .from("claim_attachments")
          .select("id, claim_id, bucket_name, file_path, content_type")
          .in(
            "claim_id",
            claims.map((claim) => claim.id),
          )
      : Promise.resolve({ data: [] }),
  ]);

  const signedTicketAttachments = await Promise.all(
    (ticketAttachments ?? []).map(async (attachment) => {
      const { data } = await supabase.storage
        .from(attachment.bucket_name)
        .createSignedUrl(attachment.file_path, 60 * 10);
      return {
        ...attachment,
        fileName: attachment.file_path.split("/").at(-1) ?? "Maintenance photo",
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
  const attachmentsByTicket = new Map<
    string,
    typeof signedTicketAttachments
  >();
  for (const attachment of signedTicketAttachments) {
    const list = attachmentsByTicket.get(attachment.ticket_id) ?? [];
    list.push(attachment);
    attachmentsByTicket.set(attachment.ticket_id, list);
  }

  const signedClaimAttachments = await Promise.all(
    (claimAttachments ?? []).map(async (attachment) => {
      const { data } = await supabase.storage
        .from(attachment.bucket_name)
        .createSignedUrl(attachment.file_path, 60 * 10);
      return {
        ...attachment,
        fileName: attachment.file_path.split("/").at(-1) ?? "Claim receipt",
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
  const attachmentsByClaim = new Map<
    string,
    {
      id: string;
      content_type: string | null;
      fileName: string;
      signedUrl: string | null;
    }[]
  >();
  for (const attachment of signedClaimAttachments) {
    const list = attachmentsByClaim.get(attachment.claim_id) ?? [];
    list.push({
      id: attachment.id,
      content_type: attachment.content_type,
      fileName: attachment.fileName,
      signedUrl: attachment.signedUrl,
    });
    attachmentsByClaim.set(attachment.claim_id, list);
  }

  const workQueue = [...tickets].sort((left, right) => {
    const leftCompleted = left.status === "completed" ? 1 : 0;
    const rightCompleted = right.status === "completed" ? 1 : 0;
    if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;

    const urgencyDifference =
      (urgencyOrder[left.urgency ?? "normal"] ?? 1)
      - (urgencyOrder[right.urgency ?? "normal"] ?? 1);
    if (urgencyDifference !== 0) return urgencyDifference;

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
  const openTicketCount = workQueue.filter((ticket) => ticket.status !== "completed").length;
  const urgentTicketCount = workQueue.filter(
    (ticket) => ticket.status !== "completed" && ticket.urgency === "urgent",
  ).length;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase text-[#126b5f]">Operations</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Maintenance</h1>
        <p className="mt-2 text-sm text-gray-600">
          Real maintenance and cleaning tickets controlled by Supabase RLS.
        </p>
      </div>

      {params.created === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Ticket submitted successfully.
        </div>
      ) : null}
      {params.updated === "1" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-sm">
          Maintenance ticket updated successfully.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {errorMessages[params.error] ?? "Ticket could not be saved."}
        </div>
      ) : null}
      {params.claim_submitted === "1" ? (
        <div className="rounded-lg border border-[#126b5f]/30 bg-white px-4 py-3 text-sm font-medium text-[#126b5f] shadow-sm">
          Claim submitted successfully and sent to Admin Verification.
        </div>
      ) : null}
      {params.claim_error ? (
        <div className="rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 shadow-sm">
          {claimErrorMessages[params.claim_error] ??
            "The claim could not be submitted."}
        </div>
      ) : null}

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Submit Ticket</CardTitle>
            <CardDescription>
              Tenants submit their own room request. Admin can create a ticket for any tenant and room.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createMaintenanceTicket} className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Tenant</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="tenantId" required>
                  <option value="">Choose tenant</option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>{tenant.full_name ?? tenant.id}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Room</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="roomId" required>
                  <option value="">Choose room</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Ticket type</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="ticketType" defaultValue="maintenance">
                  <option value="maintenance">Maintenance</option>
                  <option value="repair">Repair</option>
                  <option value="cleaning">Cleaning</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Urgency</span>
                <select className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="urgency" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Category optional</span>
                <input className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="category" placeholder="Aircond, plumbing, cleaning" />
              </label>
              <label className="block lg:col-span-2">
                <span className="text-sm font-medium text-gray-700">Description</span>
                <textarea className="mt-2 min-h-28 w-full rounded-md border border-[#d7dde5] px-3 py-2" name="description" required />
              </label>
              <Button className="lg:col-span-2" type="submit">Submit ticket</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Maintenance Work Queue</CardTitle>
              <CardDescription className="mt-1">
                Open jobs are listed by priority. Select any report photo to open it full size.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">
                {openTicketCount} open
              </span>
              {urgentTicketCount ? (
                <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">
                  {urgentTicketCount} urgent
                </span>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {workQueue.length ? (
            <div className="overflow-hidden rounded-lg border border-[#d7dde5]">
              <div className="hidden grid-cols-[112px_minmax(0,1fr)_minmax(200px,auto)] gap-4 bg-[#f4f6f8] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600 lg:grid">
                <span>Report photo</span>
                <span>Priority / Job details</span>
                <span>Status / Action</span>
              </div>
              <div className="divide-y divide-[#d7dde5]">
              {workQueue.map((ticket) => {
                const property = properties.find(
                  (item) => item.id === ticket.property_id,
                );
                const room = rooms.find((item) => item.id === ticket.room_id);
                const completed = ticket.status === "completed";
                return (
                  <article
                    className={`grid gap-4 p-4 lg:grid-cols-[112px_minmax(0,1fr)_minmax(200px,auto)] lg:items-start ${
                      completed
                        ? "bg-emerald-50/70"
                        : "bg-white"
                    }`}
                    key={ticket.id}
                  >
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-gray-500 lg:hidden">
                        Report photo
                      </p>
                      {(attachmentsByTicket.get(ticket.id) ?? []).length ? (
                        <div className="flex flex-wrap gap-2">
                          {(attachmentsByTicket.get(ticket.id) ?? []).map((attachment) => (
                            <DocumentPreview
                              contentType={attachment.content_type}
                              fileName={
                                attachment.attachment_type === "after"
                                  ? "Completion photo"
                                  : "Report photo"
                              }
                              key={attachment.id}
                              label={
                                attachment.attachment_type === "after"
                                  ? "completion photo"
                                  : "report photo"
                              }
                              size="sm"
                              url={attachment.signedUrl}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="flex h-16 w-20 items-center justify-center rounded-md border border-dashed border-[#cbd2dc] bg-[#f8fafc] px-2 text-center text-xs text-gray-500">
                          No photo
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={urgencyBadgeClass(ticket.urgency)}>
                            {urgencyLabel(ticket.urgency)}
                          </Badge>
                          <h2 className="font-semibold text-gray-950">
                            {ticket.ticket_number ?? ticket.id.slice(0, 8)}
                          </h2>
                          <Badge
                            className={
                              completed
                                ? "bg-emerald-100 text-emerald-700"
                                : statusBadgeClass(ticket.status)
                            }
                          >
                            {ticketStatusLabel(ticket.status)}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm font-medium">
                          {ticket.description}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          {property?.name ?? "Property"}
                          {room
                            ? ` / ${room.room_number ?? room.name ?? "Room"}`
                            : ""}
                          {" · "}
                          {formatMalaysiaDate(ticket.created_at)}
                        </p>
                      </div>
                    </div>

                    {!completed && canUpdateTicket ? (
                      <form
                        action={updateMaintenanceTicketStatus}
                        className="grid gap-3 rounded-md border border-[#e3e8ef] bg-white p-3 lg:col-span-1"
                      >
                        <input
                          name="ticketId"
                          type="hidden"
                          value={ticket.id}
                        />
                        <label className="block">
                          <span className="text-sm font-medium">Work status</span>
                          <select
                            className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                            defaultValue={
                              ticket.status === "in_progress"
                                ? "in_progress"
                                : "submitted"
                            }
                            name="status"
                          >
                            <option value="submitted">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Resolved</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium">
                            Completion photo
                          </span>
                          <input
                            accept="image/jpeg,image/png,image/webp"
                            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-sm"
                            name="completionPhoto"
                            type="file"
                          />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="text-sm font-medium">
                            Work notes (optional)
                          </span>
                          <textarea
                            className="mt-2 min-h-20 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                            name="notes"
                            placeholder="Describe the work completed"
                          />
                        </label>
                        <Button className="sm:col-span-2" type="submit">
                          Update Ticket
                        </Button>
                      </form>
                    ) : completed ? (
                      <p className="text-sm font-medium text-emerald-700">
                        Work completed and submitted.
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500">
                        View-only job.
                      </p>
                    )}
                  </article>
                );
              })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No maintenance jobs yet.</p>
          )}
        </CardContent>
      </Card>

      {role !== "admin" ? (
      <Card id="claim-bills">
        <CardHeader>
          <CardTitle>Claim Bills</CardTitle>
          <CardDescription>
            Repair bills paid with company cash or your own money. Every claim
            is checked by Admin before it becomes an expense.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {canSubmitClaim ? (
            <ClaimBillForm
              allowUnlinkedJob={canSubmitUnlinkedClaim}
              properties={properties}
              rooms={rooms}
              tickets={tickets}
            />
          ) : (
            <p className="text-sm text-gray-500">
              Claim submission is available to Management and assigned
              maintenance staff.
            </p>
          )}

          <div className="border-t border-[#e3e8ef] pt-5">
            <h3 className="font-semibold text-gray-950">Submitted Claims</h3>
            {claims.length ? (
              <div className="mt-3 space-y-3">
                {claims.map((claim) => {
                  const property = single(claim.properties);
                  const room = single(claim.rooms);
                  const attachments = attachmentsByClaim.get(claim.id) ?? [];
                  return (
                    <div
                      className="grid gap-3 rounded-md border border-[#d7dde5] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                      key={claim.id}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-950">
                            {claim.description}
                          </p>
                          <Badge className={statusBadgeClass(claim.status)}>
                            {claimStatusLabel(claim.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-gray-600">
                          {property?.name ?? "Property"}{" "}
                          {room
                            ? `- ${room.room_number ?? room.name ?? "Room"}`
                            : ""}
                          {" - "}
                          {money(claim.total_amount ?? 0)}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Submitted {formatMalaysiaDate(claim.submitted_at)} -{" "}
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
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((attachment) => (
                          <DocumentPreview
                            contentType={attachment.content_type}
                            fileName={attachment.fileName}
                            key={attachment.id}
                            label="Claim receipt"
                            showName={false}
                            size="sm"
                            url={attachment.signedUrl}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">
                No claims yet. Submit one when a repair bill is paid.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      ) : null}
    </section>
  );
}
