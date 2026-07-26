import { notFound } from "next/navigation";
import { getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type DataClient = Awaited<ReturnType<typeof createClient>>;

async function getDataClient(): Promise<DataClient> {
  try {
    return createAdminClient() as DataClient;
  } catch {
    return createClient();
  }
}

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function relatedOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const roomNumberCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export type PropertyRoomView = {
  id: string;
  name: string;
  roomNumber: string;
  status: string;
  monthlyRent: number;
  tenantId: string | null;
  tenantProfileId: string | null;
  tenantRecordId: string | null;
  tenancyId: string | null;
  tenantName: string | null;
  tenantPhone: string | null;
  identificationNumber: string | null;
  deposit: number;
  depositReceived: number;
  depositOutstanding: number;
  dueDay: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  billId: string | null;
  billStatus: string | null;
  billDueDate: string | null;
  billAmount: number;
  amountReceived: number;
  outstanding: number;
  agreementId: string | null;
  agreementStatus: string;
};

export type TenantDocumentView = {
  id: string;
  documentType: string;
  fileName: string;
  contentType: string | null;
  verificationStatus: string;
  uploadedAt: string;
  signedUrl: string | null;
};

export type TenantAgreementHistoryView = {
  id: string;
  agreementType: string;
  versionNumber: number;
  status: string;
  termStartDate: string | null;
  termEndDate: string | null;
  tenantName: string | null;
  propertyName: string | null;
  roomName: string | null;
  generatedAt: string;
  signedAt: string | null;
  signedPdfUrl: string | null;
};

export type PropertyDetailsView = {
  property: {
    id: string;
    companyId: string;
    name: string;
    code: string;
    area: string;
    address: string;
    isCommercial: boolean;
    paymentQrUrl: string | null;
  };
  rooms: PropertyRoomView[];
  occupiedCount: number;
  vacantCount: number;
  utilitySummary: {
    currentMonthWater: number;
    currentMonthElectricity: number;
    totalThisMonth: number;
    outstanding: number;
    latestStatus: string | null;
    latestPaymentDate: string | null;
  };
};

export async function getPropertyDetails(propertyId: string): Promise<PropertyDetailsView> {
  const accessible = (await getProperties()).find((property) => property.id === propertyId);
  if (!accessible) {
    notFound();
  }

  const supabase = await getDataClient();
  const currentDate = malaysiaDate();
  const billMonth = `${currentDate.slice(0, 7)}-01`;
  const [
    propertyResult,
    roomsResult,
    tenantRecordsResult,
    tenanciesResult,
    billsResult,
    depositPaymentsResult,
    depositSubmissionsResult,
    utilityBillsResult,
  ] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id, company_id, name, address, property_code, area, location, city, is_commercial, payment_qr_url")
        .eq("id", propertyId)
        .single(),
      supabase
        .from("rooms")
        .select("id, name, room_number, status, monthly_rent, current_tenancy_id")
        .eq("property_id", propertyId)
        .order("room_number", { ascending: true }),
      supabase
        .from("tenant_records")
        .select("id, tenant_id, tenancy_id, room_id, full_name, phone, identification_number, monthly_rent, deposit, due_day, contract_start, contract_end, status")
        .eq("property_id", propertyId)
        .eq("status", "active"),
      supabase
        .from("tenancies")
        .select("id, tenant_id, room_id, monthly_rental, deposit, due_day, rent_due_day, contract_start, contract_end, status, tenants(full_name, phone, identity_number, profile_id)")
        .eq("property_id", propertyId)
        .eq("status", "active"),
      supabase
        .from("rent_bills")
        .select("id, room_id, tenancy_id, tenant_record_id, amount, paid_amount, status, due_date")
        .eq("property_id", propertyId)
        .eq("bill_month", billMonth),
      supabase
        .from("payments")
        .select("room_id, amount")
        .eq("property_id", propertyId)
        .in("category", ["deposit", "rental_deposit", "security_deposit"])
        .in("status", ["confirmed", "paid"]),
      supabase
        .from("payment_submissions")
        .select("room_id, amount")
        .eq("property_id", propertyId)
        .in("payment_type", ["deposit", "rental_deposit", "security_deposit"])
        .eq("verification_status", "verified"),
      supabase
        .from("utility_bills")
        .select("utility_type, bill_month, amount, paid_amount, status, payment_date, created_at")
        .eq("property_id", propertyId)
        .eq("billing_scope", "property")
        .order("bill_month", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

  if (propertyResult.error || !propertyResult.data) {
    notFound();
  }

  const rooms = roomsResult.data ?? [];
  const tenantRecords = tenantRecordsResult.data ?? [];
  const tenancies = tenanciesResult.data ?? [];
  const bills = billsResult.data ?? [];
  const depositPayments = depositPaymentsResult.data ?? [];
  const depositSubmissions = depositSubmissionsResult.data ?? [];
  const utilityBills = utilityBillsResult.data ?? [];
  const tenancyIds = tenancies.map((tenancy) => tenancy.id);
  const agreementResult = tenancyIds.length
    ? await supabase
        .from("tenancy_agreements")
        .select("id, tenancy_id, status, created_at")
        .in("tenancy_id", tenancyIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  const agreements = agreementResult.data ?? [];

  const tenantRecordByRoom = new Map(tenantRecords.map((tenant) => [tenant.room_id, tenant]));
  const tenancyByRoom = new Map(tenancies.map((tenancy) => [tenancy.room_id, tenancy]));
  const billByRoom = new Map(bills.map((bill) => [bill.room_id, bill]));
  const agreementByTenancy = new Map<string, (typeof agreements)[number]>();
  const verifiedDepositByRoom = new Map<string, number>();
  const verifiedSubmissionDepositByRoom = new Map<string, number>();
  for (const payment of depositPayments) {
    if (!payment.room_id) continue;
    verifiedDepositByRoom.set(
      payment.room_id,
      (verifiedDepositByRoom.get(payment.room_id) ?? 0) + Number(payment.amount ?? 0),
    );
  }
  for (const submission of depositSubmissions) {
    if (!submission.room_id) continue;
    verifiedSubmissionDepositByRoom.set(
      submission.room_id,
      (verifiedSubmissionDepositByRoom.get(submission.room_id) ?? 0) + Number(submission.amount ?? 0),
    );
  }
  for (const agreement of agreements) {
    if (!agreementByTenancy.has(agreement.tenancy_id)) {
      agreementByTenancy.set(agreement.tenancy_id, agreement);
    }
  }

  const roomViews = rooms
    .map((room): PropertyRoomView => {
      const tenantRecord = tenantRecordByRoom.get(room.id);
      const tenancy = tenancyByRoom.get(room.id);
      const canonicalTenant = relatedOne(tenancy?.tenants);
      const bill = billByRoom.get(room.id);
      const tenancyId = tenancy?.id ?? tenantRecord?.tenancy_id ?? room.current_tenancy_id ?? null;
      const agreement = tenancyId ? agreementByTenancy.get(tenancyId) : null;
      const billAmount = Number(bill?.amount ?? 0);
      const amountReceived = Number(bill?.paid_amount ?? 0);
      const deposit = Number(tenancy?.deposit ?? tenantRecord?.deposit ?? 0);
      const contractEnd = tenancy?.contract_end ?? tenantRecord?.contract_end ?? null;
      // A verified submission is only used when no canonical payment exists, so verification
      // workflows that copy submissions into payments cannot double-count the deposit.
      const depositReceived =
        verifiedDepositByRoom.get(room.id) ??
        verifiedSubmissionDepositByRoom.get(room.id) ??
        0;

      return {
        id: room.id,
        name: room.name ?? room.room_number,
        roomNumber: room.room_number ?? room.name,
        status: room.status,
        monthlyRent: Number(tenancy?.monthly_rental ?? tenantRecord?.monthly_rent ?? room.monthly_rent ?? 0),
        tenantId: tenancy?.tenant_id ?? tenantRecord?.tenant_id ?? null,
        tenantProfileId: canonicalTenant?.profile_id ?? null,
        tenantRecordId: tenantRecord?.id ?? null,
        tenancyId,
        tenantName: canonicalTenant?.full_name ?? tenantRecord?.full_name ?? null,
        tenantPhone: canonicalTenant?.phone ?? tenantRecord?.phone ?? null,
        identificationNumber: canonicalTenant?.identity_number ?? tenantRecord?.identification_number ?? null,
        deposit,
        depositReceived,
        depositOutstanding: Math.max(deposit - depositReceived, 0),
        dueDay: tenancy?.rent_due_day ?? tenancy?.due_day ?? tenantRecord?.due_day ?? null,
        contractStart: tenancy?.contract_start ?? tenantRecord?.contract_start ?? null,
        contractEnd,
        billId: bill?.id ?? null,
        billStatus: bill?.status ?? null,
        billDueDate: bill?.due_date ?? null,
        billAmount,
        amountReceived,
        outstanding: bill ? Math.max(billAmount - amountReceived, 0) : 0,
        agreementId: agreement?.id ?? null,
        agreementStatus:
          agreement && contractEnd && contractEnd < currentDate
            ? "expired"
            : agreement?.status ?? "not_generated",
      };
    })
    .sort((a, b) => roomNumberCollator.compare(a.roomNumber, b.roomNumber));

  const property = propertyResult.data;
  const fallbackCode = property.name.includes("-") ? property.name.split("-")[0].trim() : "";
  const activeUtilityBills = utilityBills.filter((bill) => bill.status !== "cancelled");
  const currentUtilityBills = activeUtilityBills.filter((bill) => bill.bill_month === billMonth);
  const latestUtilityBill = activeUtilityBills[0] ?? null;

  return {
    property: {
      id: property.id,
      companyId: property.company_id,
      name: property.name,
      code: property.property_code ?? fallbackCode,
      area: property.area ?? property.location ?? property.city ?? "",
      address: property.address ?? "",
      isCommercial: Boolean(property.is_commercial),
      paymentQrUrl: property.payment_qr_url,
    },
    rooms: roomViews,
    occupiedCount: roomViews.filter((room) => room.status === "occupied").length,
    vacantCount: roomViews.filter((room) => room.status === "vacant").length,
    utilitySummary: {
      currentMonthWater: currentUtilityBills
        .filter((bill) => bill.utility_type === "water")
        .reduce((sum, bill) => sum + Number(bill.amount ?? 0), 0),
      currentMonthElectricity: currentUtilityBills
        .filter((bill) => bill.utility_type === "electricity")
        .reduce((sum, bill) => sum + Number(bill.amount ?? 0), 0),
      totalThisMonth: currentUtilityBills.reduce(
        (sum, bill) => sum + Number(bill.amount ?? 0),
        0,
      ),
      outstanding: activeUtilityBills.reduce(
        (sum, bill) =>
          sum + Math.max(Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0), 0),
        0,
      ),
      latestStatus: latestUtilityBill?.status ?? null,
      latestPaymentDate: latestUtilityBill?.payment_date ?? null,
    },
  };
}

export async function getRoomDetails(
  propertyId: string,
  roomId: string,
  options: {
    includeSensitiveDocuments?: boolean;
    includeAllTenantTerms?: boolean;
  } = {},
) {
  const propertyDetails = await getPropertyDetails(propertyId);
  const room = propertyDetails.rooms.find((item) => item.id === roomId);
  if (!room) {
    notFound();
  }

  const supabase = await getDataClient();
  const [billsResult, paymentsResult, maintenanceResult, metersResult] = await Promise.all([
    supabase
      .from("rent_bills")
      .select("id, bill_month, due_date, amount, paid_amount, status")
      .eq("room_id", roomId)
      .order("bill_month", { ascending: false }),
    supabase
      .from("payments")
      .select("id, amount, payment_date, payment_method, reference_number, status, verified_at")
      .eq("room_id", roomId)
      .order("payment_date", { ascending: false }),
    supabase
      .from("maintenance_tickets")
      .select("id, ticket_number, category, description, urgency, status, created_at, completed_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false }),
    supabase
      .from("smart_meters")
      .select("id, meter_number, meter_type, rate, remaining_credit, status")
      .eq("room_id", roomId)
      .order("meter_type", { ascending: true }),
  ]);
  const meters = metersResult.data ?? [];
  const meterIds = meters.map((meter) => meter.id);
  const readingsResult = meterIds.length
    ? await supabase
        .from("smart_meter_readings")
        .select("id, meter_id, billing_month, previous_reading, current_reading, usage, rate, charge_amount, top_up_amount, remaining_credit, reading_date")
        .in("meter_id", meterIds)
        .order("reading_date", { ascending: false })
    : { data: [], error: null };
  const readings = readingsResult.data ?? [];
  const [relatedTenantRecordsResult, relatedTenanciesResult] = await Promise.all([
    room.tenantId
      ? supabase
          .from("tenant_records")
          .select("id")
          .eq("tenant_id", room.tenantId)
      : Promise.resolve({ data: room.tenantRecordId ? [{ id: room.tenantRecordId }] : [] }),
    room.tenantId && options.includeAllTenantTerms
      ? supabase
          .from("tenancies")
          .select("id")
          .eq("tenant_id", room.tenantId)
          .order("created_at", { ascending: false })
      : room.tenantId
        ? supabase
            .from("tenancies")
            .select("id")
            .eq("tenant_id", room.tenantId)
            .eq("room_id", roomId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: room.tenancyId ? [{ id: room.tenancyId }] : [] }),
  ]);
  const tenantRecordIds = Array.from(
    new Set(
      (relatedTenantRecordsResult.data ?? [])
        .map((record) => record.id)
        .concat(room.tenantRecordId ? [room.tenantRecordId] : []),
    ),
  );
  const tenancyIds = Array.from(
    new Set(
      (relatedTenanciesResult.data ?? [])
        .map((tenancy) => tenancy.id)
        .concat(room.tenancyId ? [room.tenancyId] : []),
    ),
  );

  const tenantDocumentRows: Array<{
    id: string;
    document_type: string;
    file_name: string | null;
    file_path: string;
    content_type: string | null;
    verification_status: string;
    uploaded_at: string;
  }> = [];

  if (options.includeSensitiveDocuments) {
    if (tenantRecordIds.length) {
      const { data } = await supabase
        .from("tenant_documents")
        .select("id, document_type, file_name, file_path, content_type, verification_status, uploaded_at")
        .in("tenant_record_id", tenantRecordIds)
        .order("uploaded_at", { ascending: false });
      tenantDocumentRows.push(...(data ?? []));
    }

    if (room.tenantProfileId) {
      const { data } = await supabase
        .from("tenant_documents")
        .select("id, document_type, file_name, file_path, content_type, verification_status, uploaded_at")
        .eq("tenant_id", room.tenantProfileId)
        .order("uploaded_at", { ascending: false });
      for (const document of data ?? []) {
        if (!tenantDocumentRows.some((item) => item.id === document.id)) {
          tenantDocumentRows.push(document);
        }
      }
    }
  }

  const documents: TenantDocumentView[] = await Promise.all(
    tenantDocumentRows.map(async (document) => {
      const { data } = await supabase.storage
        .from("tenant-documents")
        .createSignedUrl(document.file_path, 60 * 15);
      return {
        id: document.id,
        documentType: document.document_type,
        fileName: document.file_name ?? document.file_path.split("/").at(-1) ?? "Document",
        contentType: document.content_type,
        verificationStatus: document.verification_status,
        uploadedAt: document.uploaded_at,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );

  const agreementsResult = tenancyIds.length
    ? await supabase
        .from("tenancy_agreements")
        .select("id, tenancy_id, agreement_type, version_number, status, term_start_date, term_end_date, tenant_name_snapshot, property_name_snapshot, room_name_snapshot, generated_at, signed_at, pdf_url, tenancies(tenancy_start_date, tenancy_end_date, contract_start, contract_end, properties(name), rooms(name, room_number))")
        .in("tenancy_id", tenancyIds)
        .order("term_start_date", { ascending: false, nullsFirst: false })
        .order("generated_at", { ascending: false })
    : { data: [], error: null };

  const agreementHistory: TenantAgreementHistoryView[] = await Promise.all(
    (agreementsResult.data ?? []).map(async (agreement) => {
      const tenancy = relatedOne(agreement.tenancies);
      const agreementProperty = relatedOne(tenancy?.properties);
      const agreementRoom = relatedOne(tenancy?.rooms);
      const signedPdf = agreement.pdf_url
        ? await supabase.storage
            .from("tenancy-agreements")
            .createSignedUrl(agreement.pdf_url, 60 * 15)
        : { data: null };

      return {
        id: agreement.id,
        agreementType: agreement.agreement_type,
        versionNumber: agreement.version_number,
        status: agreement.status,
        termStartDate:
          agreement.term_start_date ??
          tenancy?.tenancy_start_date ??
          tenancy?.contract_start ??
          null,
        termEndDate:
          agreement.term_end_date ??
          tenancy?.tenancy_end_date ??
          tenancy?.contract_end ??
          null,
        tenantName: agreement.tenant_name_snapshot ?? room.tenantName,
        propertyName:
          agreement.property_name_snapshot ?? agreementProperty?.name ?? null,
        roomName:
          agreement.room_name_snapshot ??
          agreementRoom?.room_number ??
          agreementRoom?.name ??
          null,
        generatedAt: agreement.generated_at,
        signedAt: agreement.signed_at,
        signedPdfUrl: signedPdf.data?.signedUrl ?? null,
      };
    }),
  );

  return {
    property: propertyDetails.property,
    room,
    bills: billsResult.data ?? [],
    payments: paymentsResult.data ?? [],
    maintenance: maintenanceResult.data ?? [],
    smartMeters: meters.map((meter) => ({
      ...meter,
      readings: readings.filter((reading) => reading.meter_id === meter.id),
    })),
    documents,
    agreementHistory,
  };
}

export async function getTenantProfile(
  tenantKey: string,
  options: { includeSensitiveDocuments?: boolean } = {},
) {
  const supabase = await getDataClient();
  const { data: importedTenant } = await supabase
    .from("tenant_records")
    .select("id, property_id, room_id")
    .eq("id", tenantKey)
    .maybeSingle();

  if (importedTenant?.property_id && importedTenant.room_id) {
    return getRoomDetails(importedTenant.property_id, importedTenant.room_id, {
      ...options,
      includeAllTenantTerms: true,
    });
  }

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("property_id, room_id")
    .eq("tenant_id", tenantKey)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tenancy?.property_id || !tenancy.room_id) {
    notFound();
  }

  return getRoomDetails(tenancy.property_id, tenancy.room_id, {
    ...options,
    includeAllTenantTerms: true,
  });
}
