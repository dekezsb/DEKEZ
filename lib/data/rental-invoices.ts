import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getVerifiedDepositPaymentMaps,
  verifiedDepositPaid,
} from "@/lib/invoices/deposit-payments";

type BillRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_source: string;
  issued_at: string;
  retain_until: string;
  organization_id: string | null;
  tenancy_id: string | null;
  tenant_record_id: string | null;
  property_id: string;
  room_id: string;
  bill_month: string;
  due_date: string;
  amount: number | string;
  deposit_amount: number | string;
  paid_amount: number | string;
  status: string;
  notes: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removal_reason: string | null;
  created_at: string;
};

type InvoiceParty = {
  full_name: string | null;
  phone: string | null;
  email: string | null;
  identity_number?: string | null;
};

type InvoiceProperty = {
  id: string;
  name: string;
  property_code: string | null;
  area: string | null;
  address: string | null;
};

type InvoiceRoom = {
  id: string;
  name: string | null;
  room_number: string | null;
};

type InvoiceTenancy = {
  id: string;
  tenant_id: string;
  contract_start: string | null;
  contract_end: string | null;
  check_in_date: string | null;
  checkout_date: string | null;
};

export type RentalInvoiceReceipt = {
  id: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string | null;
  verifiedAt: string | null;
  retainUntil: string | null;
  filePath: string;
  fileName: string;
  contentType: string | null;
  signedUrl: string | null;
};

export type RentalInvoiceView = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  retainUntil: string;
  billMonth: string;
  dueDate: string;
  amount: number;
  depositAmount: number;
  depositPaidAmount: number;
  invoiceTotal: number;
  invoicePaidAmount: number;
  paidAmount: number;
  outstanding: number;
  status: string;
  invoiceStatus: string;
  invoiceSource: string;
  notes: string | null;
  removedAt: string | null;
  removedBy: string | null;
  removalReason: string | null;
  tenantName: string;
  tenantPhone: string | null;
  tenantEmail: string | null;
  tenantIdentityNumber: string | null;
  propertyId: string;
  propertyName: string;
  propertyCode: string;
  propertyArea: string | null;
  propertyAddress: string | null;
  roomId: string;
  roomName: string;
  tenancyId: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  receipts: RentalInvoiceReceipt[];
  receiptCount: number;
};

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function billSelect() {
  return [
    "id",
    "invoice_number",
    "invoice_date",
    "invoice_source",
    "issued_at",
    "retain_until",
    "organization_id",
    "tenancy_id",
    "tenant_record_id",
    "property_id",
    "room_id",
    "bill_month",
    "due_date",
    "amount",
    "deposit_amount",
    "paid_amount",
    "status",
    "notes",
    "removed_at",
    "removed_by",
    "removal_reason",
    "created_at",
  ].join(", ");
}

function receiptContentType(fileName: string) {
  if (/\.pdf$/i.test(fileName)) return "application/pdf";
  if (/\.(?:avif|gif|jpe?g|png|webp)$/i.test(fileName)) return "image/*";
  return null;
}

async function getInvoiceReceipts(
  billIds: string[],
  signUrls: boolean,
) {
  if (!billIds.length) return new Map<string, RentalInvoiceReceipt[]>();

  const supabase = signUrls ? createAdminClient() : await createClient();
  const { data: submissions } = await supabase
    .from("payment_submissions")
    .select(
      "id, rent_bill_id, amount, payment_date, payment_method, reference_number, receipt_url, verified_at, retain_until",
    )
    .in("rent_bill_id", billIds)
    .eq("verification_status", "verified")
    .not("receipt_url", "is", null)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });

  const submissionIds = (submissions ?? []).map((submission) => submission.id);
  const { data: attachments } = submissionIds.length
    ? await supabase
        .from("payment_attachments")
        .select("payment_submission_id, file_name, content_type")
        .in("payment_submission_id", submissionIds)
    : { data: [] };
  const attachmentBySubmission = new Map(
    (attachments ?? []).map((attachment) => [
      attachment.payment_submission_id,
      attachment,
    ]),
  );
  const signedUrlByPath = new Map<string, string>();

  if (signUrls) {
    await Promise.all(
      (submissions ?? []).map(async (submission) => {
        if (!submission.receipt_url) return;
        const { data } = await supabase.storage
          .from("payment-receipts")
          .createSignedUrl(submission.receipt_url, 60 * 60);
        if (data?.signedUrl) {
          signedUrlByPath.set(submission.receipt_url, data.signedUrl);
        }
      }),
    );
  }

  const receiptsByBill = new Map<string, RentalInvoiceReceipt[]>();
  for (const submission of submissions ?? []) {
    if (!submission.rent_bill_id || !submission.receipt_url) continue;
    const attachment = attachmentBySubmission.get(submission.id);
    const fileName =
      attachment?.file_name ??
      submission.receipt_url.split("/").at(-1) ??
      "Payment receipt";
    const receipts = receiptsByBill.get(submission.rent_bill_id) ?? [];
    receipts.push({
      id: submission.id,
      amount: numberValue(submission.amount),
      paymentDate: submission.payment_date,
      paymentMethod: submission.payment_method,
      referenceNumber: submission.reference_number,
      verifiedAt: submission.verified_at,
      retainUntil: submission.retain_until,
      filePath: submission.receipt_url,
      fileName,
      contentType:
        attachment?.content_type ?? receiptContentType(fileName),
      signedUrl: signedUrlByPath.get(submission.receipt_url) ?? null,
    });
    receiptsByBill.set(submission.rent_bill_id, receipts);
  }

  return receiptsByBill;
}

async function hydrateInvoices(
  bills: BillRow[],
  options: { signReceiptUrls?: boolean } = {},
): Promise<RentalInvoiceView[]> {
  if (!bills.length) return [];

  const supabase = await createClient();
  const propertyIds = [...new Set(bills.map((bill) => bill.property_id))];
  const roomIds = [...new Set(bills.map((bill) => bill.room_id))];
  const tenancyIds = [
    ...new Set(
      bills
        .map((bill) => bill.tenancy_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const tenantRecordIds = [
    ...new Set(
      bills
        .map((bill) => bill.tenant_record_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [propertiesResult, roomsResult, tenanciesResult, recordsResult] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id, name, property_code, area, address")
        .in("id", propertyIds),
      supabase
        .from("rooms")
        .select("id, name, room_number")
        .in("id", roomIds),
      tenancyIds.length
        ? supabase
            .from("tenancies")
            .select(
              "id, tenant_id, contract_start, contract_end, check_in_date, checkout_date",
            )
            .in("id", tenancyIds)
        : Promise.resolve({ data: [], error: null }),
      tenantRecordIds.length
        ? supabase
            .from("tenant_records")
            .select("id, full_name, phone, email, identification_number")
            .in("id", tenantRecordIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const tenancies = (tenanciesResult.data ?? []) as InvoiceTenancy[];
  const tenantIds = [...new Set(tenancies.map((tenancy) => tenancy.tenant_id))];
  const tenantsResult = tenantIds.length
    ? await supabase
        .from("tenants")
        .select("id, full_name, phone, email, identity_number")
        .in("id", tenantIds)
    : { data: [], error: null };

  const propertyById = new Map(
    ((propertiesResult.data ?? []) as InvoiceProperty[]).map((property) => [
      property.id,
      property,
    ]),
  );
  const roomById = new Map(
    ((roomsResult.data ?? []) as InvoiceRoom[]).map((room) => [room.id, room]),
  );
  const tenancyById = new Map(
    tenancies.map((tenancy) => [tenancy.id, tenancy]),
  );
  const tenantById = new Map(
    ((tenantsResult.data ?? []) as Array<InvoiceParty & { id: string }>).map(
      (tenant) => [tenant.id, tenant],
    ),
  );
  const tenantRecordById = new Map(
    (
      (recordsResult.data ?? []) as Array<
        InvoiceParty & { id: string; identification_number: string | null }
      >
    ).map((record) => [record.id, record]),
  );
  const depositPaymentMaps = await getVerifiedDepositPaymentMaps(
    supabase,
    tenancyIds,
    tenantRecordIds,
  );
  const receiptsByBill = await getInvoiceReceipts(
    bills.map((bill) => bill.id),
    options.signReceiptUrls ?? false,
  );

  return bills.map((bill) => {
    const property = propertyById.get(bill.property_id);
    const room = roomById.get(bill.room_id);
    const tenancy = bill.tenancy_id
      ? tenancyById.get(bill.tenancy_id)
      : undefined;
    const canonicalTenant = tenancy
      ? tenantById.get(tenancy.tenant_id)
      : undefined;
    const importedTenant = bill.tenant_record_id
      ? tenantRecordById.get(bill.tenant_record_id)
      : undefined;
    const tenant = canonicalTenant ?? importedTenant;
    const amount = numberValue(bill.amount);
    const paidAmount = numberValue(bill.paid_amount);
    const depositAmount = numberValue(bill.deposit_amount);
    const depositPaidAmount = verifiedDepositPaid(depositPaymentMaps, {
      tenancyId: bill.tenancy_id,
      tenantRecordId: bill.tenant_record_id,
      depositAmount,
    });
    const invoiceTotal = amount + depositAmount;
    const invoicePaidAmount = Math.min(
      paidAmount + depositPaidAmount,
      invoiceTotal,
    );
    const outstanding = ["cancelled", "waived"].includes(bill.status)
      ? 0
      : Math.max(invoiceTotal - invoicePaidAmount, 0);
    const invoiceStatus = ["cancelled", "waived"].includes(bill.status)
      ? bill.status
      : outstanding <= 0.005
        ? "paid"
        : invoicePaidAmount > 0
          ? "partial"
          : bill.status;
    const receipts = receiptsByBill.get(bill.id) ?? [];

    return {
      id: bill.id,
      invoiceNumber: bill.invoice_number,
      invoiceDate: bill.invoice_date,
      retainUntil: bill.retain_until,
      billMonth: bill.bill_month,
      dueDate: bill.due_date,
      amount,
      depositAmount,
      depositPaidAmount,
      invoiceTotal,
      invoicePaidAmount,
      paidAmount,
      outstanding,
      status: bill.status,
      invoiceStatus,
      invoiceSource: bill.invoice_source,
      notes: bill.notes,
      removedAt: bill.removed_at,
      removedBy: bill.removed_by,
      removalReason: bill.removal_reason,
      tenantName: tenant?.full_name ?? "Tenant",
      tenantPhone: tenant?.phone ?? null,
      tenantEmail: tenant?.email ?? null,
      tenantIdentityNumber:
        canonicalTenant?.identity_number ??
        importedTenant?.identification_number ??
        null,
      propertyId: bill.property_id,
      propertyName: property?.name ?? "Property",
      propertyCode: property?.property_code ?? "",
      propertyArea: property?.area ?? null,
      propertyAddress: property?.address ?? null,
      roomId: bill.room_id,
      roomName: room?.room_number ?? room?.name ?? "Room",
      tenancyId: bill.tenancy_id,
      contractStart:
        tenancy?.check_in_date ?? tenancy?.contract_start ?? null,
      contractEnd:
        tenancy?.checkout_date ?? tenancy?.contract_end ?? null,
      receipts,
      receiptCount: receipts.length,
    };
  });
}

export async function getHistoricalInvoiceOptions() {
  const supabase = await createClient();
  const [tenantRecordsResult, propertiesResult, roomsResult] = await Promise.all([
    supabase
      .from("tenant_records")
      .select(
        "id, full_name, phone, status, property_id, room_id, monthly_rent, tenancy_id",
      )
      .order("full_name", { ascending: true }),
    supabase
      .from("properties")
      .select("id, name, property_code")
      .order("name", { ascending: true }),
    supabase
      .from("rooms")
      .select("id, property_id, name, room_number")
      .order("room_number", { ascending: true }),
  ]);

  const properties = (propertiesResult.data ?? []).map((property) => ({
    id: property.id,
    name: property.name,
    code: property.property_code,
  }));
  const propertyById = new Map(
    properties.map((property) => [property.id, property]),
  );
  const rooms = (roomsResult.data ?? [])
    .map((room) => ({
      id: room.id,
      propertyId: room.property_id,
      name: room.room_number ?? room.name ?? "Room",
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  return {
    tenants: (tenantRecordsResult.data ?? []).map((tenant) => {
      const property = tenant.property_id
        ? propertyById.get(tenant.property_id)
        : null;
      const room = tenant.room_id ? roomById.get(tenant.room_id) : null;
      return {
        id: tenant.id,
        name: tenant.full_name,
        phone: tenant.phone,
        status: tenant.status,
        propertyId: tenant.property_id,
        propertyName: property?.code ?? property?.name ?? null,
        roomId: tenant.room_id,
        roomName: room?.name ?? null,
        monthlyRent: numberValue(tenant.monthly_rent),
        tenancyId: tenant.tenancy_id,
      };
    }),
    properties,
    rooms,
  };
}

export async function getRentalInvoice(invoiceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rent_bills")
    .select(billSelect())
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !data) return null;
  return (
    await hydrateInvoices([data as unknown as BillRow], {
      signReceiptUrls: true,
    })
  )[0] ?? null;
}

export async function getRentalInvoiceArchive(input: {
  page?: number;
  pageSize?: number;
  invoiceNumber?: string;
  month?: string;
  status?: string;
}) {
  const supabase = await createClient();
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("rent_bills")
    .select(billSelect(), { count: "exact" })
    .order("due_date", { ascending: false })
    .order("invoice_number", { ascending: false })
    .range(from, to);

  if (input.invoiceNumber?.trim()) {
    query = query.ilike(
      "invoice_number",
      `%${input.invoiceNumber.trim()}%`,
    );
  }
  if (input.month && /^\d{4}-\d{2}$/.test(input.month)) {
    query = query.eq("bill_month", `${input.month}-01`);
  }
  if (input.status && input.status !== "all") {
    query = query.eq("status", input.status);
  }

  const { data, count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return {
    invoices: await hydrateInvoices((data ?? []) as unknown as BillRow[]),
    total: count ?? 0,
    page,
    pageSize,
  };
}
