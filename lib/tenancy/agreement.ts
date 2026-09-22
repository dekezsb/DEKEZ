import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMalaysiaDate } from "@/lib/date-format";
import {
  addDays,
  calculateTermEndDate,
  defaultAgreementTemplate,
  renderAgreementTemplate,
} from "@/lib/e-tenancy";
import {
  STANDARD_AGREEMENT_NAME,
  STANDARD_AGREEMENT_VERSION,
} from "@/lib/tenancy/standard-agreement";
import {
  agreementTypeForProperty,
  agreementTypeVariables,
  type AgreementDocumentType,
} from "@/lib/tenancy/agreement-types";
import { commercialDepositSchedule } from "@/lib/tenancy/commercial-deposit-policy";
import { standbyPlan, type StandbySource } from "@/lib/tenancy/standby-policy";
import {
  loadPropertyTenancySettings,
  propertyAgreementVariables,
  type PropertyTenancySettings,
} from "@/lib/tenancy/property-settings";

type AgreementTermType = "original" | "renewal";

type TenancyContext = {
  id: string;
  company_id: string;
  rental_model: string | null;
  tenant_id: string;
  property_id: string;
  room_id: string | null;
  monthly_rental: number | string | null;
  deposit: number | string | null;
  security_deposit_override: number | string | null;
  utility_deposit_override: number | string | null;
  start_date: string;
  end_date: string | null;
  contract_start: string | null;
  contract_end: string | null;
  tenancy_start_date: string | null;
  tenancy_end_date: string | null;
  check_in_date: string | null;
  checkout_date: string | null;
  contract_duration_months: number | null;
  rent_due_day: number | null;
  renewal_status: string | null;
  status: string;
  billing_status: string | null;
  tenants: {
    full_name: string;
    email: string | null;
    phone: string | null;
    identity_number: string | null;
    tenant_type: string | null;
    business_name: string | null;
    business_registration_number: string | null;
    registered_address: string | null;
    authorised_representative_name: string | null;
    representative_identity_number: string | null;
    business_contact_number: string | null;
    business_email: string | null;
  } | null;
  properties: {
    name: string;
    address: string | null;
    property_code: string | null;
    is_commercial: boolean;
    property_type: string | null;
  } | null;
  rooms: {
    name: string | null;
    room_number: string;
  } | null;
};

type ExistingAgreement = {
  id: string;
  version_number: number;
  term_start_date: string | null;
  term_end_date: string | null;
  status: string;
  agreement_type: AgreementDocumentType;
};

type RegenerableAgreement = ExistingAgreement & {
  tenancy_id: string;
  monthly_rent_snapshot: number | string | null;
};

export function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function renewalDurationMonths(isCommercial: boolean) {
  return isCommercial ? 12 : 6;
}

function agreementStatusForTerm(endDate: string) {
  return endDate < malaysiaToday() ? "expired" : "pending_signature";
}

function agreementAmount(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

async function loadTenancyContext(
  supabase: SupabaseClient,
  tenancyId: string,
): Promise<TenancyContext | null> {
  const { data: tenancy, error: tenancyError } = await supabase
    .from("tenancies")
    .select(
      "id, company_id, rental_model, tenant_id, property_id, room_id, monthly_rental, deposit, security_deposit_override, utility_deposit_override, start_date, end_date, contract_start, contract_end, tenancy_start_date, tenancy_end_date, check_in_date, checkout_date, contract_duration_months, rent_due_day, renewal_status, status, billing_status",
    )
    .eq("id", tenancyId)
    .maybeSingle();

  if (tenancyError) {
    throw new Error(`Unable to load tenancy: ${tenancyError.message}`);
  }
  if (!tenancy?.property_id) {
    return null;
  }

  const [tenantResult, propertyResult, roomResult] = await Promise.all([
    supabase
      .from("tenants")
      .select(
        "full_name, email, phone, identity_number, tenant_type, business_name, business_registration_number, registered_address, authorised_representative_name, representative_identity_number, business_contact_number, business_email",
      )
      .eq("id", tenancy.tenant_id)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("name, address, property_code, is_commercial, property_type")
      .eq("id", tenancy.property_id)
      .maybeSingle(),
    tenancy.room_id
      ? supabase
          .from("rooms")
          .select("name, room_number")
          .eq("id", tenancy.room_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const linkedError =
    tenantResult.error ?? propertyResult.error ?? roomResult.error;
  if (linkedError) {
    throw new Error(`Unable to load tenancy details: ${linkedError.message}`);
  }

  return {
    ...tenancy,
    tenants: tenantResult.data,
    properties: propertyResult.data,
    rooms: roomResult.data,
  } as TenancyContext;
}

async function ensureMasterTemplate(
  supabase: SupabaseClient,
  userId: string | null,
) {
  const { data: existing } = await supabase
    .from("tenancy_agreement_templates")
    .select("id, template_content, is_active")
    .is("property_id", null)
    .eq("name", STANDARD_AGREEMENT_NAME)
    .eq("version", STANDARD_AGREEMENT_VERSION)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("tenancy_agreement_templates")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .is("property_id", null)
      .eq("name", STANDARD_AGREEMENT_NAME)
      .neq("version", STANDARD_AGREEMENT_VERSION);

    if (
      existing.template_content !== defaultAgreementTemplate ||
      !existing.is_active
    ) {
      const { data: updated } = await supabase
        .from("tenancy_agreement_templates")
        .update({
          template_content: defaultAgreementTemplate,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id, template_content")
        .single();
      return updated ?? existing;
    }
    return existing;
  }

  await supabase
    .from("tenancy_agreement_templates")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .is("property_id", null)
    .eq("name", STANDARD_AGREEMENT_NAME);

  const { data, error } = await supabase
    .from("tenancy_agreement_templates")
    .insert({
      property_id: null,
      name: STANDARD_AGREEMENT_NAME,
      template_content: defaultAgreementTemplate,
      version: STANDARD_AGREEMENT_VERSION,
      is_active: true,
      created_by: userId,
    })
    .select("id, template_content")
    .single();

  if (error || !data) {
    const { data: concurrent } = await supabase
      .from("tenancy_agreement_templates")
      .select("id, template_content")
      .is("property_id", null)
      .eq("name", STANDARD_AGREEMENT_NAME)
      .eq("version", STANDARD_AGREEMENT_VERSION)
      .maybeSingle();
    if (concurrent) return concurrent;
    throw new Error(error?.message ?? "Unable to create the master tenancy template.");
  }

  return data;
}

function renderAgreement(
  context: TenancyContext,
  templateContent: string,
  startDate: string,
  endDate: string,
  durationMonths: number,
  monthlyRent: number,
  propertySettings: PropertyTenancySettings,
  agreementType: AgreementDocumentType,
) {
  const isCommercialOffice = agreementType === "commercial_office";
  const commercialDeposits = commercialDepositSchedule(monthlyRent, {
    securityDeposit: context.security_deposit_override,
    utilityDeposit: context.utility_deposit_override,
  });
  const securityDeposit = isCommercialOffice
    ? commercialDeposits.securityDeposit
    : Number(context.deposit ?? 0);
  const utilityDeposit = isCommercialOffice
    ? commercialDeposits.utilityDeposit
    : 0;
  const totalDeposit = isCommercialOffice
    ? commercialDeposits.totalDeposit
    : securityDeposit + utilityDeposit;

  return renderAgreementTemplate(templateContent, {
    agreement_date: formatMalaysiaDate(startDate),
    landlord_address:
      "Lot 30, Kian Yap Industrial Estate, Lorong Durian 3, Kota Kinabalu, Sabah, Malaysia",
    tenant_name: context.tenants?.full_name,
    tenant_ic_passport: context.tenants?.identity_number,
    tenant_phone: context.tenants?.phone,
    tenant_email: context.tenants?.email,
    property_name: context.properties?.name,
    property_code: context.properties?.property_code,
    room_number: context.rooms?.room_number ?? context.rooms?.name,
    premise_address: context.properties?.address,
    property_address: context.properties?.address,
    monthly_rent: agreementAmount(monthlyRent),
    deposit_amount: agreementAmount(totalDeposit),
    security_deposit: agreementAmount(securityDeposit),
    utility_deposit: agreementAmount(utilityDeposit),
    key_deposit: agreementAmount(0),
    other_deposit: agreementAmount(0),
    deposit_schedule_clause: isCommercialOffice
      ? context.security_deposit_override != null && context.utility_deposit_override != null
        ? `For this tenancy, the agreed Security Deposit remains RM ${agreementAmount(securityDeposit)} and the Utility Deposit remains RM ${agreementAmount(utilityDeposit)}, totalling RM ${agreementAmount(totalDeposit)}. No deposit top-up is required for the current agreed rent.`
        : `For this commercial office tenancy, the Security Deposit is fixed at two (2) months of Monthly Rent and the Utility Deposit is fixed at one-half (0.5) month of Monthly Rent. The total commercial deposit required is RM ${agreementAmount(totalDeposit)}.`
      : "The deposit amounts applicable to this tenancy are the amounts stated above.",
    rent_due_day: context.rent_due_day ?? new Date(`${startDate}T00:00:00Z`).getUTCDate(),
    tenancy_start_date: formatMalaysiaDate(startDate),
    tenancy_end_date: formatMalaysiaDate(endDate),
    contract_duration_months: durationMonths,
    first_payment_due_date: formatMalaysiaDate(addDays(startDate, 7)),
    late_fee_per_day: "0.00",
    late_fee_start_day: "the day after the due date",
    deposit_refund_days: 30,
    utility_payment_days: 7,
    defect_reporting_days: 2,
    lost_key_fee: "0.00",
    lost_card_fee: "0.00",
    lockout_fee: "0.00",
    lock_change_fee: "0.00",
    unauthorised_occupant_fee: "0.00",
    renewal_notice_months: 1,
    checkout_notice_months: 1,
    abandoned_item_days: 30,
    landlord_representative_name: "Director of DEKEZ",
    landlord_representative_role: "Director",
    landlord_representative_ic: "950222-12-5502",
    landlord_signature: "[LANDLORD_SIGNATURE]",
    landlord_signature_date: formatMalaysiaDate(startDate),
    tenant_signature: "[Pending tenant signature]",
    tenant_signature_date: "-",
    ...agreementTypeVariables(agreementType, {
      fullName: context.tenants?.full_name,
      identityNumber: context.tenants?.identity_number,
      phone: context.tenants?.phone,
      email: context.tenants?.email,
      tenantType: context.tenants?.tenant_type,
      businessName: context.tenants?.business_name,
      businessRegistrationNumber:
        context.tenants?.business_registration_number,
      registeredAddress: context.tenants?.registered_address,
      authorisedRepresentativeName:
        context.tenants?.authorised_representative_name,
      representativeIdentityNumber:
        context.tenants?.representative_identity_number,
      businessContactNumber: context.tenants?.business_contact_number,
      businessEmail: context.tenants?.business_email,
    }),
    ...propertyAgreementVariables(propertySettings, agreementType),
  });
}

function durationForTerm(
  startDate: string,
  endDate: string,
  fallback: number,
) {
  const candidates = Array.from(
    new Set([fallback, 6, 12, ...Array.from({ length: 36 }, (_, index) => index + 1)]),
  );
  return (
    candidates.find(
      (duration) => calculateTermEndDate(startDate, duration) === endDate,
    ) ?? fallback
  );
}

async function renderExistingAgreement(
  supabase: SupabaseClient,
  agreement: RegenerableAgreement,
  templateContent: string,
  monthlyRent?: number,
  agreementTypeOverride?: AgreementDocumentType,
) {
  const context = await loadTenancyContext(supabase, agreement.tenancy_id);
  if (!context) {
    throw new Error("The tenancy linked to this agreement was not found.");
  }

  const startDate =
    agreement.term_start_date ??
    context.check_in_date ??
    context.tenancy_start_date ??
    context.contract_start ??
    context.start_date;
  const fallbackDuration =
    context.contract_duration_months ??
    renewalDurationMonths(context.properties?.is_commercial ?? false);
  const endDate =
    agreement.term_end_date ??
    context.checkout_date ??
    context.tenancy_end_date ??
    context.contract_end ??
    context.end_date ??
    calculateTermEndDate(startDate, fallbackDuration);
  const duration = durationForTerm(startDate, endDate, fallbackDuration);
  const settings = await loadPropertyTenancySettings(
    supabase,
    context.property_id,
    context.properties?.is_commercial ?? false,
  );
  const agreementType =
    agreementTypeOverride ??
    agreementTypeForProperty(context.properties?.is_commercial ?? false);

  return {
    agreementType,
    context,
    renderedContent: renderAgreement(
      context,
      templateContent,
      startDate,
      endDate,
      duration,
      monthlyRent ?? Number(agreement.monthly_rent_snapshot ?? context.monthly_rental ?? 0),
      settings,
      agreementType,
    ),
  };
}

async function linkRenewalAgreement(
  supabase: SupabaseClient,
  context: TenancyContext,
  userId: string,
  {
    agreementId,
    durationMonths,
    endDate,
    monthlyRent,
    startDate,
  }: {
    agreementId: string;
    durationMonths: number;
    endDate: string;
    monthlyRent: number;
    startDate: string;
  },
  standbyOnly = false,
) {
  const renewalStatus =
    agreementStatusForTerm(endDate) === "expired"
      ? "expired"
      : "renewal_pending";
  const { data: existingRenewal, error: renewalLookupError } = await supabase
    .from("tenancy_renewals")
    .select("id")
    .eq("tenancy_id", context.id)
    .eq("new_start_date", startDate)
    .maybeSingle();

  if (renewalLookupError) throw new Error(renewalLookupError.message);

  if (existingRenewal) {
    const { error } = await supabase
      .from("tenancy_renewals")
      .update({
        selected_duration_months: durationMonths,
        renewal_status: renewalStatus,
        new_end_date: endDate,
        new_agreement_id: agreementId,
        new_monthly_rent: monthlyRent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingRenewal.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("tenancy_renewals").insert({
    tenancy_id: context.id,
    selected_duration_months: durationMonths,
    renewal_status: renewalStatus,
    decision_status: standbyOnly ? "pending" : "renew",
    decision_recorded_at: standbyOnly ? null : new Date().toISOString(),
    decision_recorded_by: standbyOnly ? null : userId,
    decision_channel: standbyOnly ? "admin_prepared_offer" : "admin_direct",
    new_start_date: startDate,
    new_end_date: endDate,
    new_agreement_id: agreementId,
    new_monthly_rent: monthlyRent,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
}

async function createTermAgreement(
  supabase: SupabaseClient,
  context: TenancyContext,
  userId: string,
  {
    termType,
    agreementType,
    startDate,
    endDate,
    durationMonths,
    monthlyRent,
    updateExistingRent,
    standbyOnly = false,
  }: {
    termType: AgreementTermType;
    agreementType: AgreementDocumentType;
    startDate: string;
    endDate: string;
    durationMonths: number;
    monthlyRent: number;
    updateExistingRent: boolean;
    standbyOnly?: boolean;
  },
) {
  const { data: sameTerm, error: sameTermError } = await supabase
    .from("tenancy_agreements")
    .select("id, status, agreement_type, monthly_rent_snapshot")
    .eq("tenancy_id", context.id)
    .eq("term_start_date", startDate)
    .eq("term_end_date", endDate)
    .is("admin_rejected_at", null)
    .is("replacement_agreement_id", null)
    .limit(1)
    .maybeSingle();

  if (sameTermError) throw new Error(sameTermError.message);
  if (sameTerm) {
    if (
      (updateExistingRent || sameTerm.agreement_type !== agreementType) &&
      !["signed", "renewal_signed"].includes(sameTerm.status)
    ) {
      await updateUnsignedAgreementRent(
        supabase,
        sameTerm.id,
        updateExistingRent
          ? monthlyRent
          : Number(sameTerm.monthly_rent_snapshot ?? monthlyRent),
      );
    }
    if (termType === "renewal") {
      await linkRenewalAgreement(supabase, context, userId, {
        agreementId: sameTerm.id,
        durationMonths,
        endDate,
        monthlyRent,
        startDate,
      }, standbyOnly);
    }
    return { id: sameTerm.id, created: false };
  }

  const [{ data: agreements }, template, propertySettings] = await Promise.all([
    supabase
      .from("tenancy_agreements")
      .select(
        "id, version_number, term_start_date, term_end_date, status, agreement_type",
      )
      .eq("tenancy_id", context.id)
      .order("term_end_date", { ascending: false }),
    ensureMasterTemplate(supabase, userId),
    loadPropertyTenancySettings(
      supabase,
      context.property_id,
      context.properties?.is_commercial ?? false,
    ),
  ]);
  const existing = (agreements ?? []) as ExistingAgreement[];
  const previous = existing[0] ?? null;
  const versionNumber =
    Math.max(0, ...existing.map((agreement) => agreement.version_number ?? 0)) + 1;

  const { data: agreement, error } = await supabase
    .from("tenancy_agreements")
    .insert({
      tenancy_id: context.id,
      template_id: template.id,
      term_type: termType,
      agreement_type: agreementType,
      version_number: versionNumber,
      status: agreementStatusForTerm(endDate),
      rendered_content: renderAgreement(
        context,
        template.template_content,
        startDate,
        endDate,
        durationMonths,
        monthlyRent,
        propertySettings,
        agreementType,
      ),
      monthly_rent_snapshot: monthlyRent,
      term_start_date: startDate,
      term_end_date: endDate,
      tenant_name_snapshot: context.tenants?.full_name ?? null,
      property_name_snapshot: context.properties?.name ?? null,
      room_name_snapshot:
        context.rooms?.room_number ?? context.rooms?.name ?? null,
      previous_agreement_id: previous?.id ?? null,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !agreement) {
    throw new Error(error?.message ?? "Unable to create the tenancy agreement.");
  }

  if (!standbyOnly && agreementStatusForTerm(endDate) !== "expired") {
    await supabase.from("agreement_notifications").insert({
      tenancy_id: context.id,
      agreement_id: agreement.id,
      notification_type:
        termType === "renewal"
          ? "renewal_signature_request"
          : "signature_request",
      status: "pending",
      due_at: new Date().toISOString(),
    });
  }

  if (termType === "renewal") {
    await linkRenewalAgreement(supabase, context, userId, {
      agreementId: agreement.id,
      durationMonths,
      endDate,
      monthlyRent,
      startDate,
    }, standbyOnly);
  }

  return { id: agreement.id, created: true };
}

export async function createAgreementForTenancy(
  supabase: SupabaseClient,
  tenancyId: string,
  userId: string,
  options: {
    monthlyRent?: number;
  } = {},
) {
  const context = await loadTenancyContext(supabase, tenancyId);
  if (!context) {
    return null;
  }

  const startDate =
    context.check_in_date ??
    context.tenancy_start_date ??
    context.contract_start ??
    context.start_date;
  const duration =
    context.contract_duration_months ??
    renewalDurationMonths(context.properties?.is_commercial ?? false);
  const standardEndDate = calculateTermEndDate(startDate, duration);
  const endDate =
    context.checkout_date ??
    (context.properties?.is_commercial
      ? standardEndDate
      : context.tenancy_end_date ??
        context.contract_end ??
        context.end_date ??
        standardEndDate);
  const agreementType = agreementTypeForProperty(
    context.properties?.is_commercial ?? false,
  );

  const agreement = await createTermAgreement(supabase, context, userId, {
    termType: "original",
    agreementType,
    startDate,
    endDate,
    durationMonths: duration,
    monthlyRent: options.monthlyRent ?? Number(context.monthly_rental ?? 0),
    updateExistingRent: options.monthlyRent !== undefined,
  });

  return agreement.id;
}

export async function createRentChangeAgreement(
  supabase: SupabaseClient,
  tenancyId: string,
  userId: string,
  options: {
    effectiveStartDate: string;
    monthlyRent: number;
  },
) {
  const context = await loadTenancyContext(supabase, tenancyId);
  if (!context || !Number.isFinite(options.monthlyRent) || options.monthlyRent <= 0) {
    return null;
  }

  const { data: agreements } = await supabase
    .from("tenancy_agreements")
    .select("term_end_date")
    .eq("tenancy_id", tenancyId)
    .is("admin_rejected_at", null)
    .not("term_end_date", "is", null)
    .gte("term_end_date", options.effectiveStartDate)
    .order("term_end_date", { ascending: false })
    .limit(1);
  const existingEndDate = agreements?.[0]?.term_end_date ?? null;
  const fallbackDuration =
    context.contract_duration_months ??
    renewalDurationMonths(context.properties?.is_commercial ?? false);
  const endDate =
    existingEndDate ??
    context.checkout_date ??
    context.tenancy_end_date ??
    context.contract_end ??
    context.end_date ??
    calculateTermEndDate(options.effectiveStartDate, fallbackDuration);
  const duration = durationForTerm(
    options.effectiveStartDate,
    endDate,
    fallbackDuration,
  );

  return createTermAgreement(supabase, context, userId, {
    termType: "renewal",
    agreementType: agreementTypeForProperty(
      context.properties?.is_commercial ?? false,
    ),
    startDate: options.effectiveStartDate,
    endDate,
    durationMonths: duration,
    monthlyRent: options.monthlyRent,
    updateExistingRent: true,
  });
}

export async function prepareNextRenewalAgreement(
  supabase: SupabaseClient,
  tenancyId: string,
  userId: string,
  options: {
    monthlyRent?: number;
  } = {},
) {
  const context = await loadTenancyContext(supabase, tenancyId);
  if (
    !context ||
    context.status !== "active" ||
    context.checkout_date ||
    context.billing_status === "terminated" ||
    context.billing_status === "completed"
  ) {
    return null;
  }

  const currentEndDate =
    context.tenancy_end_date ?? context.contract_end ?? context.end_date;
  if (!currentEndDate) {
    return null;
  }

  const reminderDate = addDays(currentEndDate, -60);
  if (reminderDate > malaysiaToday()) {
    return null;
  }

  const startDate = addDays(currentEndDate, 1);
  const { data: decision } = await supabase
    .from("tenancy_renewals")
    .select("id, new_end_date, decision_status")
    .eq("tenancy_id", tenancyId)
    .eq("new_start_date", startDate)
    .eq("decision_status", "renew")
    .maybeSingle();
  if (!decision) {
    return null;
  }

  await createAgreementForTenancy(supabase, tenancyId, userId);

  const duration = renewalDurationMonths(
    context.properties?.is_commercial ?? false,
  );
  const endDate =
    decision.new_end_date ?? calculateTermEndDate(startDate, duration);
  const agreement = await createTermAgreement(supabase, context, userId, {
    termType: "renewal",
    agreementType: agreementTypeForProperty(
      context.properties?.is_commercial ?? false,
    ),
    startDate,
    endDate,
    durationMonths: duration,
    monthlyRent:
      options.monthlyRent ?? Number(context.monthly_rental ?? 0),
    updateExistingRent: options.monthlyRent !== undefined,
  });

  if (endDate >= malaysiaToday()) {
    await supabase
      .from("tenancies")
      .update({
        renewal_status: "pending_signature",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenancyId);
  }

  return agreement.id;
}

export async function updateUnsignedAgreementRent(
  supabase: SupabaseClient,
  agreementId: string,
  monthlyRent: number,
) {
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    throw new Error("Enter a valid monthly rent for this agreement term.");
  }

  const { data: agreement, error: agreementError } = await supabase
    .from("tenancy_agreements")
    .select(
      "id, tenancy_id, version_number, term_start_date, term_end_date, status, monthly_rent_snapshot, agreement_type, signed_at, admin_rejected_at, replacement_agreement_id",
    )
    .eq("id", agreementId)
    .maybeSingle();

  if (agreementError || !agreement) {
    throw new Error(agreementError?.message ?? "Agreement not found.");
  }
  if (agreement.signed_at || agreement.admin_rejected_at || agreement.replacement_agreement_id || ["signed", "renewal_signed"].includes(agreement.status)) {
    throw new Error("A signed agreement rent cannot be changed.");
  }

  const template = await ensureMasterTemplate(supabase, null);
  const targetAgreement = agreement as RegenerableAgreement;
  const { agreementType, renderedContent } = await renderExistingAgreement(
    supabase,
    targetAgreement,
    template.template_content,
    monthlyRent,
  );

  const { data: updated, error: updateError } = await supabase
    .from("tenancy_agreements")
    .update({
      template_id: template.id,
      agreement_type: agreementType,
      monthly_rent_snapshot: monthlyRent,
      rendered_content: renderedContent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agreement.id)
    .not("status", "in", "(signed,renewal_signed)")
    .is("signed_at", null)
    .is("admin_rejected_at", null)
    .is("replacement_agreement_id", null)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    throw new Error(
      updateError?.message ?? "The agreement rent could not be updated.",
    );
  }

  await supabase
    .from("tenancy_renewals")
    .update({
      new_monthly_rent: monthlyRent,
      updated_at: new Date().toISOString(),
    })
    .eq("new_agreement_id", agreement.id);

  return updated.id;
}

export async function renderSignedAgreementReplacement(
  supabase: SupabaseClient,
  agreementId: string,
  userId: string,
) {
  const { data: agreement, error: agreementError } = await supabase
    .from("tenancy_agreements")
    .select(
      "id, tenancy_id, version_number, term_start_date, term_end_date, status, monthly_rent_snapshot, agreement_type",
    )
    .eq("id", agreementId)
    .maybeSingle();

  if (agreementError || !agreement) {
    throw new Error(agreementError?.message ?? "Agreement not found.");
  }
  if (!["signed", "renewal_signed"].includes(agreement.status)) {
    throw new Error("Only a signed agreement can be replaced for re-signing.");
  }
  if (!agreement.term_start_date || !agreement.term_end_date) {
    throw new Error("The signed agreement term dates are incomplete.");
  }
  const monthlyRent = Number(agreement.monthly_rent_snapshot ?? 0);
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    throw new Error("The signed agreement rent snapshot is invalid.");
  }

  const template = await ensureMasterTemplate(supabase, userId);
  const { agreementType, renderedContent } = await renderExistingAgreement(
    supabase,
    agreement as RegenerableAgreement,
    template.template_content,
    monthlyRent,
    agreement.agreement_type as AgreementDocumentType,
  );

  if (!renderedContent.includes("[Pending tenant signature]")) {
    throw new Error("The replacement agreement is not ready for tenant signature.");
  }

  return {
    agreementType,
    renderedContent,
    templateId: template.id,
  };
}

export async function regenerateAllUnsignedAgreements(
  supabase: SupabaseClient,
  userId: string,
) {
  const [{ data: agreements, error }, template] = await Promise.all([
    supabase
      .from("tenancy_agreements")
      .select(
        "id, tenancy_id, version_number, term_start_date, term_end_date, status, monthly_rent_snapshot, agreement_type",
      )
      .not("status", "in", "(signed,renewal_signed)")
      .order("created_at", { ascending: true }),
    ensureMasterTemplate(supabase, userId),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  const items = (agreements ?? []) as RegenerableAgreement[];
  let regenerated = 0;
  let skipped = 0;
  const errors: Array<{ agreementId: string; message: string }> = [];

  for (let index = 0; index < items.length; index += 10) {
    const batch = items.slice(index, index + 10);
    const results = await Promise.all(
      batch.map(async (agreement) => {
        try {
          const { agreementType, renderedContent } = await renderExistingAgreement(
            supabase,
            agreement,
            template.template_content,
          );
          const { data: updated, error: updateError } = await supabase
            .from("tenancy_agreements")
            .update({
              template_id: template.id,
              agreement_type: agreementType,
              rendered_content: renderedContent,
              updated_at: new Date().toISOString(),
            })
            .eq("id", agreement.id)
            .not("status", "in", "(signed,renewal_signed)")
            .select("id")
            .maybeSingle();

          if (updateError) {
            throw new Error(updateError.message);
          }
          return updated ? "regenerated" : "skipped";
        } catch (agreementError) {
          errors.push({
            agreementId: agreement.id,
            message:
              agreementError instanceof Error
                ? agreementError.message
                : "Agreement regeneration failed.",
          });
          return "skipped";
        }
      }),
    );

    regenerated += results.filter((result) => result === "regenerated").length;
    skipped += results.filter((result) => result === "skipped").length;
  }

  return {
    total: items.length,
    regenerated,
    skipped,
    errors,
  };
}

export async function ensureCurrentAgreementTerms(
  supabase: SupabaseClient,
  tenancyId: string,
  userId: string,
) {
  const context = await loadTenancyContext(supabase, tenancyId);
  if (!context) {
    return [];
  }

  const created: string[] = [];
  const { data: existingOriginal, error: originalError } = await supabase
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("term_type", "original")
    .is("admin_rejected_at", null)
    .limit(1)
    .maybeSingle();
  if (originalError) throw new Error(originalError.message);
  // A renewed tenancy's current end date is not a new ORIGINAL term.
  // Preserve existing history rather than creating overlapping V1-style copies.
  if (!existingOriginal) {
    const originalId = await createAgreementForTenancy(supabase, tenancyId, userId);
    if (originalId) created.push(originalId);
  }

  const standbyIds = await prepareStandbyRenewal(supabase, tenancyId, userId);
  created.push(...standbyIds);

  return created;
}

// Portal maintenance prepares offers, not tenant decisions or outbound messages.
export async function prepareStandbyRenewal(
  supabase: SupabaseClient, tenancyId: string, userId: string,
) {
  const context = await loadTenancyContext(supabase, tenancyId);
  if (!context || context.status !== "active" || context.checkout_date ||
    context.rental_model === "monthly_stay" ||
    ["terminated", "completed"].includes(context.billing_status ?? "")) return [];
  const { data, error } = await supabase.from("tenancy_agreements")
    .select("id, term_type, version_number, term_start_date, term_end_date, signed_at, admin_verified_at, admin_rejected_at, replacement_agreement_id, monthly_rent_snapshot, rendered_content")
    .eq("tenancy_id", tenancyId);
  if (error) throw new Error(error.message);
  const plan = standbyPlan((data ?? []) as StandbySource[], malaysiaToday());
  if (!plan.source) return [];
  if (plan.review) throw new Error(plan.review);
  const rent = Number(context.monthly_rental);
  if (!Number.isFinite(rent) || rent <= 0) throw new Error("Current rent needs management review");
  const currentEnd = context.tenancy_end_date ?? context.contract_end ?? context.end_date;
  if (currentEnd && currentEnd > plan.source.term_end_date!) {
    throw new Error("Tenancy dates and latest TA disagree; management must review");
  }
  const audit = async (action: string, entityId: string, metadata: Record<string, unknown>) => {
    const result = await supabase.from("audit_logs").insert({
      company_id: context.company_id, actor_profile_id: userId,
      action, entity_table: "tenancy_agreements", entity_id: entityId, metadata,
    });
    if (result.error) throw new Error(result.error.message);
  };
  if (!plan.source.signed_at && plan.source.term_end_date! >= malaysiaToday() &&
    Number(plan.source.monthly_rent_snapshot) !== rent) {
    const source = (data ?? []).find(a => a.id === plan.source!.id);
    await audit("standby_rent_correction_requested", plan.source.id, {
      previous_rent: plan.source.monthly_rent_snapshot, new_rent: rent,
      previous_content: source?.rendered_content, reason: "Management standing instruction: latest unsigned TA uses current confirmed rent",
    });
    await updateUnsignedAgreementRent(supabase, plan.source.id, rent);
    await audit("standby_rent_corrected", plan.source.id, { new_rent: rent });
  }
  if (!plan.next) return [];
  const { startDate, endDate, months } = plan.next;
  const { data: decision, error: decisionError } = await supabase.from("tenancy_renewals")
    .select("decision_status, new_end_date")
    .eq("tenancy_id", tenancyId).eq("new_start_date", startDate).maybeSingle();
  if (decisionError) throw new Error(decisionError.message);
  if (decision?.decision_status === "not_renew") return [];
  if (decision?.new_end_date && decision.new_end_date !== endDate) {
    throw new Error("Saved renewal dates differ; management must review");
  }
  await audit("standby_renewal_requested", plan.source.id, {
    startDate, endDate, months, rent, tenant_consent_recorded: false,
  });
  const next = await createTermAgreement(supabase, context, userId, {
    termType: "renewal", agreementType: agreementTypeForProperty(context.properties?.is_commercial ?? false),
    startDate, endDate, durationMonths: months, monthlyRent: rent,
    updateExistingRent: false, standbyOnly: true,
  });
  if (next.created) await audit("standby_renewal_prepared", next.id, {
    previous_agreement_id: plan.source.id, startDate, endDate, months, rent,
    tenant_consent_recorded: false, outbound_message_sent: false,
  });
  return next.created ? [next.id] : [];
}
