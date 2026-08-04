import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getVerifiedDepositPaymentMaps,
  verifiedDepositPaid,
} from "@/lib/invoices/deposit-payments";

type Relation<T> = T | T[] | null;

function one<T>(relation: Relation<T>) {
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function visiblePaymentSubmissions<
  T extends {
    rent_bill_id: string | null;
    verification_status: string;
    rejection_reason: string | null;
  },
>(submissions: T[]) {
  const pendingBills = new Set<string>();

  return submissions.filter((submission) => {
    if (submission.rejection_reason === "Superseded duplicate submission") {
      return false;
    }

    if (
      submission.rent_bill_id &&
      submission.verification_status === "pending_verification"
    ) {
      if (pendingBills.has(submission.rent_bill_id)) return false;
      pendingBills.add(submission.rent_bill_id);
    }

    return true;
  });
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
  const [profileResult, tenantRecordsResult, submissionsResult, ticketsResult, documentsResult, applicationsResult] =
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
      dataClient
        .from("tenant_applications")
        .select("emergency_contact_name, emergency_contact_number")
        .eq("tenant_id", user.id)
        .order("submitted_at", { ascending: false })
        .limit(1),
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
    properties: Relation<{
      name: string;
      property_code: string | null;
      payment_qr_url: string | null;
    }>;
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
            .select("id, name, property_code, payment_qr_url")
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
        {
          name: property.name,
          property_code: property.property_code,
          payment_qr_url: property.payment_qr_url,
        },
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
  const tenancyRoomIds = tenancies.map((tenancy) => tenancy.room_id);

  let bills: Array<{
    id: string;
    tenancy_id: string | null;
    property_id: string;
    room_id: string;
    invoice_number: string;
    invoice_date: string;
    issued_at: string;
    retain_until: string;
    bill_month: string;
    due_date: string;
    amount: number | string;
    deposit_amount: number | string;
    paid_amount: number | string;
    status: string;
    created_at: string;
    properties: Relation<{ name: string }>;
    rooms: Relation<{ name: string | null; room_number: string | null }>;
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
    term_type: string;
    agreement_type: string;
    version_number: number;
    status: string;
    generated_at: string;
    signed_at: string | null;
    pdf_url: string | null;
    term_start_date: string | null;
    term_end_date: string | null;
  }> = [];
  let smartMeters: Array<{
    id: string;
    tenancy_id: string | null;
    tenant_id: string | null;
    room_id: string;
    meter_number: string;
    remaining_credit: number | string;
    rate: number | string;
    status: string;
  }> = [];

  const billColumns =
    "id, tenancy_id, property_id, room_id, invoice_number, invoice_date, issued_at, retain_until, bill_month, due_date, amount, deposit_amount, paid_amount, status, created_at, properties(name), rooms(name, room_number)";
  const [tenancyBillsResult, directBillsResult] = await Promise.all([
    tenancyIds.length
      ? dataClient
          .from("rent_bills")
          .select(billColumns)
          .in("tenancy_id", tenancyIds)
          .order("bill_month", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    dataClient
      .from("rent_bills")
      .select(billColumns)
      .eq("tenant_id", user.id)
      .order("bill_month", { ascending: false }),
  ]);
  bills = Array.from(
    new Map(
      [...(tenancyBillsResult.data ?? []), ...(directBillsResult.data ?? [])].map(
        (bill) => [bill.id, bill],
      ),
    ).values(),
  ).sort((left, right) => right.bill_month.localeCompare(left.bill_month)) as typeof bills;
  const depositPaymentMaps = await getVerifiedDepositPaymentMaps(
    dataClient,
    tenancyIds,
    [],
  );
  const invoiceBills = bills.map((bill) => {
    const amount = numberValue(bill.amount);
    const paidAmount = numberValue(bill.paid_amount);
    const depositAmount = numberValue(bill.deposit_amount);
    const depositPaidAmount = verifiedDepositPaid(depositPaymentMaps, {
      tenancyId: bill.tenancy_id,
      tenantRecordId: null,
      depositAmount,
    });
    const invoiceTotal = amount + depositAmount;
    const invoicePaidAmount = Math.min(
      paidAmount + depositPaidAmount,
      invoiceTotal,
    );
    const outstanding = ["cancelled", "waived"].includes(String(bill.status))
      ? 0
      : Math.max(invoiceTotal - invoicePaidAmount, 0);
    const invoiceStatus = ["cancelled", "waived"].includes(String(bill.status))
      ? String(bill.status)
      : outstanding <= 0.005
        ? "paid"
        : invoicePaidAmount > 0
          ? "partial"
          : String(bill.status);

    return {
      ...bill,
      amount,
      depositAmount,
      depositPaidAmount,
      invoiceTotal,
      paidAmount,
      invoicePaidAmount,
      outstanding,
      invoiceStatus,
    };
  });

  if (tenancyIds.length) {
    const [paymentsResult, agreementsResult, smartMetersResult] = await Promise.all([
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
          "id, tenancy_id, term_type, agreement_type, version_number, status, generated_at, signed_at, pdf_url, term_start_date, term_end_date",
        )
        .in("tenancy_id", tenancyIds)
        .order("generated_at", { ascending: false }),
      dataClient
        .from("smart_meters")
        .select(
          "id, tenancy_id, tenant_id, room_id, meter_number, remaining_credit, rate, status",
        )
        .eq("meter_type", "electricity")
        .eq("status", "active")
        .in("room_id", tenancyRoomIds),
    ]);
    payments = (paymentsResult.data ?? []) as typeof payments;
    agreements = (agreementsResult.data ?? []) as typeof agreements;
    smartMeters = (smartMetersResult.data ?? []) as typeof smartMeters;
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
  const submissions = await Promise.all(
    visiblePaymentSubmissions(submissionsResult.data ?? []).map(
      async (submission) => ({
        ...submission,
        amount: numberValue(submission.amount),
        signedReceiptUrl: await signedUrl(
          dataClient,
          "payment-receipts",
          submission.receipt_url,
        ),
      }),
    ),
  );

  const portalTenancies = await Promise.all(
    tenancies
      .filter(
        (tenancy) =>
          tenancy.status === "active" &&
          !["completed", "terminated"].includes(
            String(tenancy.billing_status),
          ),
      )
      .map(async (tenancy) => {
        const tenancyProperty = one(tenancy.properties);
        const tenancyRoom = one(tenancy.rooms);
        const electricityMeter = smartMeters.find(
          (meter) =>
            meter.tenancy_id === tenancy.id || meter.room_id === tenancy.room_id,
        );
        const tenancyQrUrl = await signedUrl(
          dataClient,
          "room-payment-qr",
          tenancyRoom?.payment_qr_path ?? null,
        );
        const tenancyOutstanding = invoiceBills
          .filter(
            (bill) =>
              bill.tenancy_id === tenancy.id &&
              !["draft", "paid", "cancelled", "waived"].includes(
                bill.invoiceStatus,
              ),
          )
          .reduce(
            (total, bill) =>
              total + bill.outstanding,
            0,
          );

        return {
          id: tenancy.id,
          tenantId: tenancy.tenant_id,
          roomId: tenancy.room_id,
          propertyName: tenancyProperty?.name ?? "Property",
          propertyCode: tenancyProperty?.property_code ?? null,
          roomName:
            tenancyRoom?.room_number ?? tenancyRoom?.name ?? "Room",
          monthlyRent: numberValue(
            tenancy.monthly_rental ?? tenancy.monthly_rent,
          ),
          deposit: numberValue(tenancy.deposit),
          dueDay: tenancy.rent_due_day ?? tenancy.due_day,
          checkIn:
            tenancy.check_in_date ??
            tenancy.contract_start ??
            tenancy.start_date,
          contractEnd:
            tenancy.contract_end ??
            tenancy.end_date ??
            tenancy.checkout_date,
          status: tenancy.status,
          outstandingAmount: tenancyOutstanding,
          paymentQrUrl:
            tenancyQrUrl ?? tenancyProperty?.payment_qr_url ?? null,
          electricityMeter: electricityMeter
            ? {
                id: electricityMeter.id,
                meterNumber: electricityMeter.meter_number,
                remainingCredit: numberValue(electricityMeter.remaining_credit),
                rate: numberValue(electricityMeter.rate),
              }
            : null,
        };
      }),
  );
  const currentPortalTenancy =
    portalTenancies.find((tenancy) => tenancy.id === activeTenancy?.id) ??
    portalTenancies[0] ??
    null;
  const currentTenant =
    tenantRecords.find((tenant) => tenant.id === activeTenancy?.tenant_id) ??
    tenantRecords[0] ??
    null;
  const profile = profileResult.data;
  const tenantApplication = applicationsResult.data?.[0] ?? null;
  const outstandingAmount = invoiceBills
    .filter(
      (bill) =>
        !["draft", "paid", "cancelled", "waived"].includes(
          bill.invoiceStatus,
        ),
    )
    .reduce(
      (total, bill) => total + bill.outstanding,
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
      emergencyContactName:
        tenantApplication?.emergency_contact_name ?? null,
      emergencyContactNumber:
        tenantApplication?.emergency_contact_number ?? null,
      registrationStatus: profile?.registration_status ?? "approved",
    },
    hasTenancy: portalTenancies.length > 0,
    tenancy: currentPortalTenancy,
    tenancies: portalTenancies,
    outstandingAmount,
    bills: invoiceBills.map((bill) => ({
      ...bill,
      propertyName: one(bill.properties)?.name ?? "Property",
      roomName:
        one(bill.rooms)?.room_number ?? one(bill.rooms)?.name ?? "Room",
      verifiedReceipts: submissions
        .filter(
          (submission) =>
            submission.rent_bill_id === bill.id &&
            submission.verification_status === "verified" &&
            Boolean(submission.signedReceiptUrl),
        )
        .map((submission) => ({
          id: submission.id,
          amount: submission.amount,
          paymentDate: submission.payment_date,
          fileName:
            submission.receipt_url?.split("/").at(-1) ??
            "Payment receipt",
          signedUrl: submission.signedReceiptUrl,
        })),
    })),
    payments: payments.map((payment) => ({
      ...payment,
      amount: numberValue(payment.amount),
    })),
    submissions,
    tickets,
    documents,
    agreements,
  };
}
