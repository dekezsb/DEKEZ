import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Relation<T> = T | T[] | null;

function one<T>(relation: Relation<T>) {
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

async function signedUrl(
  supabase:
    | Awaited<ReturnType<typeof createClient>>
    | ReturnType<typeof createAdminClient>,
  bucket: string,
  path: string | null,
) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export type TenantPortalData = Awaited<ReturnType<typeof getTenantPortalData>>;

export async function getTenantPortalData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Every privileged query below is explicitly scoped from the authenticated
  // profile to its linked tenant and tenancy IDs.
  const dataClient = createAdminClient();
  const [profileResult, tenantRecordsResult, submissionsResult, ticketsResult, documentsResult] =
    await Promise.all([
      dataClient
        .from("profiles")
        .select(
          "id, full_name, phone, registration_status, identity_type, identity_number",
        )
        .eq("id", user.id)
        .maybeSingle(),
      dataClient
        .from("tenants")
        .select(
          "id, full_name, email, phone, identity_number, status, company_id",
        )
        .eq("profile_id", user.id)
        .order("updated_at", { ascending: false }),
      dataClient
        .from("payment_submissions")
        .select(
          "id, rent_bill_id, tenancy_id, bill_month, bill_type, amount, payment_date, payment_method, reference_number, receipt_url, verification_status, verified_at, rejection_reason, created_at",
        )
        .eq("tenant_id", user.id)
        .order("created_at", { ascending: false }),
      dataClient
        .from("maintenance_tickets")
        .select(
          "id, ticket_number, category, description, urgency, status, created_at, completed_at, properties(name), rooms(name, room_number), maintenance_attachments(id, bucket_name, file_path, content_type, created_at)",
        )
        .eq("tenant_id", user.id)
        .order("created_at", { ascending: false }),
      dataClient
        .from("tenant_documents")
        .select(
          "id, document_type, file_path, file_name, content_type, verification_status, uploaded_at",
        )
        .eq("tenant_id", user.id)
        .order("uploaded_at", { ascending: false }),
    ]);

  const tenantRecords = tenantRecordsResult.data ?? [];
  const tenantIds = tenantRecords.map((tenant) => tenant.id);
  let tenancies: Array<{
    id: string;
    tenant_id: string;
    property_id: string | null;
    room_id: string;
    monthly_rent: number | string | null;
    monthly_rental: number | string | null;
    deposit: number | string | null;
    due_day: number | null;
    rent_due_day: number | null;
    start_date: string | null;
    end_date: string | null;
    contract_start: string | null;
    contract_end: string | null;
    check_in_date: string | null;
    checkout_date: string | null;
    status: string;
    billing_status: string | null;
    created_at: string;
    properties: Relation<{ name: string; payment_qr_url: string | null }>;
    rooms: Relation<{
      name: string | null;
      room_number: string | null;
      payment_qr_path: string | null;
    }>;
  }> = [];

  if (tenantIds.length) {
    const { data } = await dataClient
      .from("tenancies")
      .select(
        "id, tenant_id, property_id, room_id, monthly_rent, monthly_rental, deposit, due_day, rent_due_day, start_date, end_date, contract_start, contract_end, check_in_date, checkout_date, status, billing_status, created_at",
      )
      .in("tenant_id", tenantIds)
      .order("created_at", { ascending: false });
    const rawTenancies = data ?? [];
    const propertyIds = [
      ...new Set(
        rawTenancies
          .map((tenancy) => tenancy.property_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const roomIds = [
      ...new Set(rawTenancies.map((tenancy) => tenancy.room_id)),
    ];
    const [propertiesResult, roomsResult] = await Promise.all([
      propertyIds.length
        ? dataClient
            .from("properties")
            .select("id, name, payment_qr_url")
            .in("id", propertyIds)
        : Promise.resolve({ data: [] }),
      roomIds.length
        ? dataClient
            .from("rooms")
            .select("id, name, room_number, payment_qr_path")
            .in("id", roomIds)
        : Promise.resolve({ data: [] }),
    ]);
    const propertyNames = new Map(
      (propertiesResult.data ?? []).map((property) => [
        property.id,
        { name: property.name },
      ]),
    );
    const roomNames = new Map(
      (roomsResult.data ?? []).map((room) => [
        room.id,
        { name: room.name, room_number: room.room_number },
      ]),
    );
    tenancies = rawTenancies.map((tenancy) => ({
      ...tenancy,
      properties: tenancy.property_id
        ? (propertyNames.get(tenancy.property_id) ?? null)
        : null,
      rooms: roomNames.get(tenancy.room_id) ?? null,
    })) as typeof tenancies;
  }

  const activeTenancy =
    tenancies.find(
      (tenancy) =>
        tenancy.status === "active" &&
        !["completed", "terminated"].includes(String(tenancy.billing_status)),
    ) ??
    tenancies[0] ??
    null;
  const tenancyIds = tenancies.map((tenancy) => tenancy.id);

  let bills: Array<{
    id: string;
    tenancy_id: string | null;
    bill_month: string;
    due_date: string;
    amount: number | string;
    paid_amount: number | string;
    status: string;
    created_at: string;
  }> = [];
  let payments: Array<{
    id: string;
    tenancy_id: string;
    rent_bill_id: string | null;
    category: string;
    amount: number | string;
    payment_date: string | null;
    payment_method: string | null;
    reference_number: string | null;
    status: string;
    verified_at: string | null;
    created_at: string;
  }> = [];
  let agreements: Array<{
    id: string;
    tenancy_id: string;
    agreement_type: string;
    version_number: number;
    status: string;
    generated_at: string;
    signed_at: string | null;
    pdf_url: string | null;
    term_start_date: string | null;
    term_end_date: string | null;
  }> = [];

  if (tenancyIds.length) {
    const [billsResult, paymentsResult, agreementsResult] = await Promise.all([
      dataClient
        .from("rent_bills")
        .select(
          "id, tenancy_id, bill_month, due_date, amount, paid_amount, status, created_at",
        )
        .in("tenancy_id", tenancyIds)
        .order("bill_month", { ascending: false }),
      dataClient
        .from("payments")
        .select(
          "id, tenancy_id, rent_bill_id, category, amount, payment_date, payment_method, reference_number, status, verified_at, created_at",
        )
        .in("tenancy_id", tenancyIds)
        .order("payment_date", { ascending: false }),
      dataClient
        .from("tenancy_agreements")
        .select(
          "id, tenancy_id, agreement_type, version_number, status, generated_at, signed_at, pdf_url, term_start_date, term_end_date",
        )
        .in("tenancy_id", tenancyIds)
        .order("generated_at", { ascending: false }),
    ]);
    bills = (billsResult.data ?? []) as typeof bills;
    payments = (paymentsResult.data ?? []) as typeof payments;
    agreements = (agreementsResult.data ?? []) as typeof agreements;
  }

  const tickets = await Promise.all(
    (ticketsResult.data ?? []).map(async (ticket) => {
      const attachments = await Promise.all(
        (ticket.maintenance_attachments ?? []).map(async (attachment) => ({
          ...attachment,
          signedUrl: await signedUrl(
            dataClient,
            attachment.bucket_name || "maintenance-attachments",
            attachment.file_path,
          ),
        })),
      );
      return {
        ...ticket,
        propertyName: one(ticket.properties)?.name ?? "Property",
        roomName:
          one(ticket.rooms)?.room_number ??
          one(ticket.rooms)?.name ??
          "Room",
        attachments,
      };
    }),
  );

  const documents = await Promise.all(
    (documentsResult.data ?? []).map(async (document) => ({
      ...document,
      signedUrl: await signedUrl(
        dataClient,
        "tenant-documents",
        document.file_path,
      ),
    })),
  );

  const currentTenant =
    tenantRecords.find((tenant) => tenant.id === activeTenancy?.tenant_id) ??
    tenantRecords[0] ??
    null;
  const profile = profileResult.data;
  const property = activeTenancy ? one(activeTenancy.properties) : null;
  const room = activeTenancy ? one(activeTenancy.rooms) : null;
  const roomQrUrl = await signedUrl(
    dataClient,
    "room-payment-qr",
    room?.payment_qr_path ?? null,
  );
  const outstandingAmount = bills
    .filter((bill) => !["paid", "cancelled", "waived"].includes(String(bill.status)))
    .reduce(
      (total, bill) =>
        total + Math.max(0, numberValue(bill.amount) - numberValue(bill.paid_amount)),
      0,
    );

  return {
    userId: user.id,
    profile: {
      fullName:
        currentTenant?.full_name ??
        profile?.full_name ??
        user.user_metadata?.full_name ??
        "Tenant",
      phone: currentTenant?.phone ?? profile?.phone ?? user.phone ?? null,
      email: currentTenant?.email ?? null,
      identityType: profile?.identity_type ?? "ic",
      identityNumber:
        currentTenant?.identity_number ?? profile?.identity_number ?? null,
      registrationStatus: profile?.registration_status ?? "approved",
    },
    hasTenancy: Boolean(activeTenancy),
    tenancy: activeTenancy
      ? {
          id: activeTenancy.id,
          propertyName: property?.name ?? "Property",
          roomName: room?.room_number ?? room?.name ?? "Room",
          monthlyRent: numberValue(
            activeTenancy.monthly_rental ?? activeTenancy.monthly_rent,
          ),
          deposit: numberValue(activeTenancy.deposit),
          dueDay: activeTenancy.rent_due_day ?? activeTenancy.due_day,
          checkIn:
            activeTenancy.check_in_date ??
            activeTenancy.contract_start ??
            activeTenancy.start_date,
          contractEnd:
            activeTenancy.contract_end ??
            activeTenancy.end_date ??
            activeTenancy.checkout_date,
          status: activeTenancy.status,
          paymentQrUrl: roomQrUrl ?? property?.payment_qr_url ?? null,
        }
      : null,
    outstandingAmount,
    bills: bills.map((bill) => ({
      ...bill,
      amount: numberValue(bill.amount),
      paidAmount: numberValue(bill.paid_amount),
      outstanding: Math.max(
        0,
        numberValue(bill.amount) - numberValue(bill.paid_amount),
      ),
    })),
    payments: payments.map((payment) => ({
      ...payment,
      amount: numberValue(payment.amount),
    })),
    submissions: (submissionsResult.data ?? []).map((submission) => ({
      ...submission,
      amount: numberValue(submission.amount),
    })),
    tickets,
    documents,
    agreements,
  };
}
