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
import {
  loadPropertyTenancySettings,
  propertyAgreementVariables,
  type PropertyTenancySettings,
} from "@/lib/tenancy/property-settings";

type AgreementTermType = "original" | "renewal";

type TenancyContext = {
  id: string;
  tenant_id: string;
  property_id: string;
  room_id: string | null;
  monthly_rental: number | string | null;
  deposit: number | string | null;
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
      "id, tenant_id, property_id, room_id, monthly_rental, deposit, start_date, end_date, contract_start, contract_end, tenancy_start_date, tenancy_end_date, check_in_date, checkout_date, contract_duration_months, rent_due_day, status, billing_status",
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
    deposit_amount: agreementAmount(context.deposit),
    security_deposit: agreementAmount(context.deposit),
    utility_deposit: agreementAmount(0),
    key_deposit: agreementAmount(0),
    other_deposit: agreementAmount(0),
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
    witness_name: "-",
    witness_ic_passport: "-",
    witness_signature: "-",
    witness_signature_date: "-",
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
  const agreementType = agreementTypeForProperty(
    context.properties?.is_commercial ?? false,
  );

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
  }: {
    termType: AgreementTermType;
    agreementType: AgreementDocumentType;
    startDate: string;
    endDate: string;
    durationMonths: number;
    monthlyRent: number;
    updateExistingRent: boolean;
  },
) {
  const { data: sameTerm } = await supabase
    .from("tenancy_agreements")
    .select("id, status, agreement_type, monthly_rent_snapshot")
    .eq("tenancy_id", context.id)
    .eq("term_start_date", startDate)
    .eq("term_end_date", endDate)
    .limit(1)
    .maybeSingle();

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

  if (agreementStatusForTerm(endDate) !== "expired") {
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
    await supabase.from("tenancy_renewals").insert({
      tenancy_id: context.id,
      selected_duration_months: durationMonths,
      renewal_status:
        agreementStatusForTerm(endDate) === "expired"
          ? "expired"
          : "renewal_pending",
      new_start_date: startDate,
      new_end_date: endDate,
      new_agreement_id: agreement.id,
      new_monthly_rent: monthlyRent,
      created_by: userId,
    });
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
  const endDate =
    context.checkout_date ??
    context.tenancy_end_date ??
    context.contract_end ??
    context.end_date ??
    calculateTermEndDate(startDate, duration);
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

  await createAgreementForTenancy(supabase, tenancyId, userId);

  const { data: agreements } = await supabase
    .from("tenancy_agreements")
    .select(
      "id, version_number, term_start_date, term_end_date, status, agreement_type",
    )
    .eq("tenancy_id", tenancyId)
    .order("term_end_date", { ascending: false });
  const latest = ((agreements ?? []) as ExistingAgreement[])[0];
  if (!latest?.term_end_date) {
    return null;
  }

  const reminderDate = addDays(latest.term_end_date, -30);
  if (reminderDate > malaysiaToday()) {
    return null;
  }

  const duration = renewalDurationMonths(
    context.properties?.is_commercial ?? false,
  );
  const startDate = addDays(latest.term_end_date, 1);
  const endDate = calculateTermEndDate(startDate, duration);
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

  if (agreement.created && endDate >= malaysiaToday()) {
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
      "id, tenancy_id, version_number, term_start_date, term_end_date, status, monthly_rent_snapshot, agreement_type",
    )
    .eq("id", agreementId)
    .maybeSingle();

  if (agreementError || !agreement) {
    throw new Error(agreementError?.message ?? "Agreement not found.");
  }
  if (["signed", "renewal_signed"].includes(agreement.status)) {
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
  const { data: existingOriginal } = await supabase
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("term_type", "original")
    .limit(1)
    .maybeSingle();
  const originalId = await createAgreementForTenancy(
    supabase,
    tenancyId,
    userId,
  );
  if (originalId && !existingOriginal) {
    created.push(originalId);
  }

  if (
    context.status !== "active" ||
    context.checkout_date ||
    ["terminated", "completed"].includes(context.billing_status ?? "")
  ) {
    return created;
  }

  for (let index = 0; index < 24; index += 1) {
    const { data: latest } = await supabase
      .from("tenancy_agreements")
      .select("id, term_end_date")
      .eq("tenancy_id", tenancyId)
      .order("term_end_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      !latest?.term_end_date ||
      addDays(latest.term_end_date, -30) > malaysiaToday()
    ) {
      break;
    }

    const renewalId = await prepareNextRenewalAgreement(
      supabase,
      tenancyId,
      userId,
    );
    if (!renewalId || renewalId === latest.id) {
      break;
    }
    created.push(renewalId);

    const { data: renewal } = await supabase
      .from("tenancy_agreements")
      .select("term_end_date")
      .eq("id", renewalId)
      .single();
    if (renewal?.term_end_date && renewal.term_end_date >= malaysiaToday()) {
      break;
    }
  }

  return created;
}
