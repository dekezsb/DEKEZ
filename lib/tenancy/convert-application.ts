import type { SupabaseClient } from "@supabase/supabase-js";
import { generateRecurringRentBills } from "@/lib/billing/rent-billing";
import { createAgreementForTenancy } from "@/lib/tenancy/agreement";
import { requiredTenancyDeposit } from "@/lib/tenancy/commercial-deposit-policy";
import { reconcileSmartLockAccessForTenancy } from "@/lib/ttlock/access";

type ConvertApplicationOptions = {
  actorId: string;
  applicationId: string;
  requireVerifiedPayment?: boolean;
};

export type ConvertApplicationResult =
  | { ok: true; tenancyId: string }
  | {
      ok: false;
      reason:
        | "application_not_ready"
        | "property_missing"
        | "room_unavailable"
        | "tenant_failed"
        | "tenancy_failed"
        | "tenant_record_failed";
    };

type ApplicationForRecovery = {
  id: string;
  property_id: string;
  room_id: string;
  monthly_rent: number | string | null;
  deposit: number | string | null;
  status: string;
  verification_status: string;
};

/**
 * A request can be interrupted after the tenancy, room and tenant record were
 * created but before the application state was finalized. Recover only when
 * the active tenancy is explicitly linked to this exact application.
 */
async function recoverLinkedTenancyConversion(
  supabase: SupabaseClient,
  application: ApplicationForRecovery,
  actorId: string,
) {
  const { data: matches } = await supabase
    .from("tenancies")
    .select(
      "id, deposit, monthly_rental, check_in_date, tenancy_start_date, contract_start, start_date",
    )
    .eq("tenant_application_id", application.id)
    .eq("property_id", application.property_id)
    .eq("room_id", application.room_id)
    .eq("status", "active")
    .is("checkout_date", null)
    .limit(2);

  if ((matches?.length ?? 0) !== 1) return null;

  const tenancy = matches![0];
  if (
    application.status === "converted_to_tenancy" &&
    application.verification_status === "verified"
  ) {
    return tenancy.id;
  }
  const deposit = Math.max(
    Number(application.deposit ?? 0),
    Number(tenancy.deposit ?? 0),
  );
  const now = new Date().toISOString();
  const startDate =
    tenancy.check_in_date ??
    tenancy.tenancy_start_date ??
    tenancy.contract_start ??
    tenancy.start_date;
  const firstBillMonth = startDate ? `${startDate.slice(0, 7)}-01` : null;

  const updates = [
    supabase
      .from("tenant_applications")
      .update({
        verification_status: "verified",
        status: "converted_to_tenancy",
        deposit,
        reviewed_by: actorId,
        reviewed_at: now,
        admin_notes:
          "Recovered the completed tenancy after an earlier approval was interrupted.",
        updated_at: now,
      })
      .eq("id", application.id),
    supabase
      .from("tenant_records")
      .update({ deposit, updated_at: now })
      .eq("tenancy_id", tenancy.id),
    supabase
      .from("tenancies")
      .update({ deposit, updated_at: now })
      .eq("id", tenancy.id),
  ];

  if (firstBillMonth) {
    updates.push(
      supabase
        .from("rent_bills")
        .update({ deposit_amount: deposit, updated_at: now })
        .eq("tenancy_id", tenancy.id)
        .eq("bill_month", firstBillMonth)
        .neq("status", "cancelled"),
    );
  }

  const results = await Promise.all(updates);
  if (results.some((result) => result.error)) return null;

  await createAgreementForTenancy(supabase, tenancy.id, actorId, {
    monthlyRent: Number(tenancy.monthly_rental ?? application.monthly_rent ?? 0),
  });

  return tenancy.id;
}

export async function convertTenantApplication(
  supabase: SupabaseClient,
  {
    actorId,
    applicationId,
    requireVerifiedPayment = false,
  }: ConvertApplicationOptions,
): Promise<ConvertApplicationResult> {
  const { data: application } = await supabase
    .from("tenant_applications")
    .select(
      "id, registration_mode, tenant_id, property_id, unit_id, room_id, full_name, ic_passport_number, whatsapp_number, contract_duration_months, proposed_start_date, proposed_end_date, monthly_rent, deposit, utility_deposit, rental_model, verification_status, payment_status, status, agreement_type, tenant_type, business_name, business_registration_number, registered_address, authorised_representative_name, representative_identity_number, business_contact_number, business_email",
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (application) {
    const recoveredTenancyId = await recoverLinkedTenancyConversion(
      supabase,
      application,
      actorId,
    );
    if (recoveredTenancyId) {
      return { ok: true, tenancyId: recoveredTenancyId };
    }
  }

  if (
    !application ||
    application.registration_mode === "reservation" ||
    application.verification_status !== "verified" ||
    (requireVerifiedPayment &&
      application.payment_status !== "verified")
  ) {
    return { ok: false, reason: "application_not_ready" };
  }

  if (application.status === "converted_to_tenancy") {
    const { data: convertedRoom } = await supabase
      .from("rooms")
      .select("current_tenancy_id")
      .eq("id", application.room_id)
      .maybeSingle();
    if (convertedRoom?.current_tenancy_id) {
      return { ok: true, tenancyId: convertedRoom.current_tenancy_id };
    }
  }

  const [{ data: property }, { data: room }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, company_id, is_commercial, rental_model")
      .eq("id", application.property_id)
      .maybeSingle(),
    supabase
      .from("rooms")
      .select("id, property_id, unit_id, status, current_tenancy_id")
      .eq("id", application.room_id)
      .eq("property_id", application.property_id)
      .maybeSingle(),
  ]);

  if (!property) {
    return { ok: false, reason: "property_missing" };
  }

  const rentalModel =
    application.rental_model === "monthly_stay" ||
    property.rental_model === "monthly_stay"
      ? "monthly_stay"
      : "tenancy";
  const isMonthlyStay = rentalModel === "monthly_stay";
  const requiredDeposit = isMonthlyStay
    ? 0
    : requiredTenancyDeposit({
        isCommercial: Boolean(property.is_commercial),
        monthlyRent: application.monthly_rent,
        statedDeposit: application.deposit,
      });

  if (!room || !["vacant", "reserved"].includes(room.status)) {
    return { ok: false, reason: "room_unavailable" };
  }

  if (room.current_tenancy_id) {
    return { ok: false, reason: "room_unavailable" };
  }

  let tenant: { id: string } | null = null;

  if (application.tenant_id) {
    const result = await supabase
      .from("tenants")
      .select("id")
      .eq("company_id", property.company_id)
      .eq("profile_id", application.tenant_id)
      .maybeSingle();
    tenant = result.data;
  }

  if (!tenant && application.ic_passport_number) {
    const result = await supabase
      .from("tenants")
      .select("id")
      .eq("company_id", property.company_id)
      .eq("identity_number", application.ic_passport_number)
      .maybeSingle();
    tenant = result.data;
  }

  if (!tenant && application.whatsapp_number) {
    const result = await supabase
      .from("tenants")
      .select("id")
      .eq("company_id", property.company_id)
      .eq("phone", application.whatsapp_number)
      .maybeSingle();
    tenant = result.data;
  }

  let createdTenant = false;
  if (!tenant) {
    const { data, error } = await supabase
      .from("tenants")
      .insert({
        company_id: property.company_id,
        profile_id: application.tenant_id,
        full_name: application.full_name,
        phone: application.whatsapp_number,
        identity_number: application.ic_passport_number,
        tenant_type: application.tenant_type ?? "individual",
        business_name: application.business_name,
        business_registration_number:
          application.business_registration_number,
        registered_address: application.registered_address,
        authorised_representative_name:
          application.authorised_representative_name,
        representative_identity_number:
          application.representative_identity_number,
        business_contact_number: application.business_contact_number,
        business_email: application.business_email,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !data) {
      return { ok: false, reason: "tenant_failed" };
    }
    tenant = data;
    createdTenant = true;
  } else {
    const businessDetails = {
      ...(application.business_name
        ? { business_name: application.business_name }
        : {}),
      ...(application.business_registration_number
        ? {
            business_registration_number:
              application.business_registration_number,
          }
        : {}),
      ...(application.registered_address
        ? { registered_address: application.registered_address }
        : {}),
      ...(application.authorised_representative_name
        ? {
            authorised_representative_name:
              application.authorised_representative_name,
          }
        : {}),
      ...(application.representative_identity_number
        ? {
            representative_identity_number:
              application.representative_identity_number,
          }
        : {}),
      ...(application.business_contact_number
        ? { business_contact_number: application.business_contact_number }
        : {}),
      ...(application.business_email
        ? { business_email: application.business_email }
        : {}),
    };

    await supabase
      .from("tenants")
      .update({
        tenant_type: application.tenant_type ?? "individual",
        ...businessDetails,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenant.id);
  }

  const dueDay = Number(application.proposed_start_date.slice(8, 10));
  const { data: tenancy, error: tenancyError } = await supabase
    .from("tenancies")
    .insert({
      company_id: property.company_id,
      tenant_id: tenant.id,
      tenant_application_id: application.id,
      room_id: room.id,
      monthly_rent: application.monthly_rent,
      deposit: requiredDeposit,
      start_date: application.proposed_start_date,
      end_date: isMonthlyStay ? null : application.proposed_end_date,
      due_day: dueDay,
      status: "active",
      property_id: property.id,
      unit_id: room.unit_id,
      monthly_rental: application.monthly_rent,
      contract_start: application.proposed_start_date,
      contract_end: isMonthlyStay ? null : application.proposed_end_date,
      tenancy_start_date: application.proposed_start_date,
      tenancy_end_date: isMonthlyStay ? null : application.proposed_end_date,
      contract_duration_months: isMonthlyStay
        ? null
        : application.contract_duration_months,
      rental_model: rentalModel,
      rent_due_day: dueDay,
      check_in_date: application.proposed_start_date,
      billing_status: "active",
      created_by: actorId,
    })
    .select("id")
    .single();

  if (tenancyError || !tenancy) {
    if (createdTenant) {
      await supabase.from("tenants").delete().eq("id", tenant.id);
    }
    return { ok: false, reason: "tenancy_failed" };
  }

  const tenantRecordId = crypto.randomUUID();
  const { error: recordError } = await supabase.from("tenant_records").insert({
    id: tenantRecordId,
    company_id: property.company_id,
    property_id: property.id,
    unit_id: room.unit_id,
    room_id: room.id,
    tenant_id: tenant.id,
    tenancy_id: tenancy.id,
    full_name: application.full_name,
    phone: application.whatsapp_number,
    identification_number: application.ic_passport_number,
    monthly_rent: application.monthly_rent,
    deposit: requiredDeposit,
    contract_start: application.proposed_start_date,
    contract_end: isMonthlyStay ? null : application.proposed_end_date,
    due_day: dueDay,
    status: "active",
    created_by: actorId,
  });

  if (recordError) {
    await supabase.from("tenancies").delete().eq("id", tenancy.id);
    if (createdTenant) {
      await supabase.from("tenants").delete().eq("id", tenant.id);
    }
    return { ok: false, reason: "tenant_record_failed" };
  }

  const { data: occupiedRoom, error: roomUpdateError } = await supabase
    .from("rooms")
    .update({
      status: "occupied",
      current_tenancy_id: tenancy.id,
      monthly_rent: application.monthly_rent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .in("status", ["vacant", "reserved"])
    .is("current_tenancy_id", null)
    .select("id")
    .maybeSingle();

  if (roomUpdateError || !occupiedRoom) {
    await Promise.all([
      supabase.from("tenant_records").delete().eq("id", tenantRecordId),
      supabase.from("tenancies").delete().eq("id", tenancy.id),
    ]);
    if (createdTenant) {
      await supabase.from("tenants").delete().eq("id", tenant.id);
    }
    return { ok: false, reason: "room_unavailable" };
  }

  await Promise.all([
    supabase
      .from("tenant_documents")
      .update({
        tenant_id: application.tenant_id,
        tenant_record_id: tenantRecordId,
      })
      .eq("tenant_application_id", application.id),
    supabase
      .from("tenant_applications")
      .update({
        status: "converted_to_tenancy",
        updated_at: new Date().toISOString(),
      })
      .eq("id", application.id),
  ]);

  await generateRecurringRentBills(supabase, {
    currentDate: application.proposed_start_date,
    createdBy: actorId,
    tenancyId: tenancy.id,
    includeTenantRecords: false,
  });
  const { data: firstBill } = await supabase
    .from("rent_bills")
    .select("id, bill_month")
    .eq("tenancy_id", tenancy.id)
    .order("bill_month", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (firstBill) {
    const { error: paymentLinkError } = await supabase
      .from("payment_submissions")
      .update({
        tenancy_id: tenancy.id,
        tenant_record_id: tenantRecordId,
        rent_bill_id: firstBill.id,
        property_id: property.id,
        unit_id: room.unit_id,
        room_id: room.id,
        bill_month: firstBill.bill_month,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_application_id", application.id)
      .eq("verification_status", "pending_verification")
      .or("tenancy_id.is.null,rent_bill_id.is.null,bill_month.is.null");

    if (paymentLinkError) {
      console.error("Converted application payment could not be linked to its first invoice.", {
        applicationId: application.id,
        tenancyId: tenancy.id,
        rentBillId: firstBill.id,
        error: paymentLinkError,
      });
    }

    await supabase
      .from("payment_submissions")
      .update({
        payment_type: "monthly_rent",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_application_id", application.id)
      .eq("payment_type", "first_month_rental")
      .eq("verification_status", "pending_verification");
  }
  if (!isMonthlyStay) {
    await createAgreementForTenancy(supabase, tenancy.id, actorId, {
      monthlyRent: Number(application.monthly_rent ?? 0),
    });
  }
  await reconcileSmartLockAccessForTenancy(tenancy.id).catch((error) => {
    console.error("Converted tenancy smart-lock access could not be provisioned.", {
      tenancyId: tenancy.id,
      error,
    });
  });
  return { ok: true, tenancyId: tenancy.id };
}
