import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMonths,
  defaultAgreementTemplate,
  money,
  renderAgreementTemplate,
} from "@/lib/e-tenancy";

function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function createAgreementForTenancy(
  supabase: SupabaseClient,
  tenancyId: string,
  userId: string,
) {
  const { data: existing } = await supabase
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("agreement_type", "original")
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select(
      "id, tenant_id, property_id, unit_id, room_id, monthly_rental, deposit, contract_start, contract_end, contract_duration_months, tenants(full_name, phone, identity_number), properties(name, address, default_ta_template_id), rooms(name, room_number)",
    )
    .eq("id", tenancyId)
    .single();

  if (!tenancy) {
    return null;
  }

  const tenant = first(tenancy.tenants);
  const property = first(tenancy.properties);
  const room = first(tenancy.rooms);
  const duration = tenancy.contract_duration_months ?? 12;
  const startDate = tenancy.contract_start ?? malaysiaToday();
  const endDate = tenancy.contract_end ?? addMonths(startDate, duration);
  let template: { id: string; template_content: string } | null = null;

  if (property?.default_ta_template_id) {
    const { data } = await supabase
      .from("tenancy_agreement_templates")
      .select("id, template_content")
      .eq("id", property.default_ta_template_id)
      .maybeSingle();
    template = data;
  }

  if (!template) {
    const { data } = await supabase
      .from("tenancy_agreement_templates")
      .insert({
        property_id: tenancy.property_id,
        name: `${property?.name ?? "Property"} Default TA`,
        template_content: defaultAgreementTemplate,
        is_active: true,
        created_by: userId,
      })
      .select("id, template_content")
      .single();
    template = data;

    if (template?.id) {
      await supabase
        .from("properties")
        .update({ default_ta_template_id: template.id })
        .eq("id", tenancy.property_id);
    }
  }

  const rendered = renderAgreementTemplate(
    template?.template_content ?? defaultAgreementTemplate,
    {
      tenant_name: tenant?.full_name,
      tenant_ic_passport: tenant?.identity_number,
      tenant_phone: tenant?.phone,
      property_name: property?.name,
      property_address: property?.address,
      unit_number: "-",
      room_number: room?.room_number ?? room?.name,
      monthly_rent: money(tenancy.monthly_rental),
      deposit_amount: money(tenancy.deposit),
      utility_deposit: money(0),
      tenancy_start_date: startDate,
      tenancy_end_date: endDate,
      contract_duration_months: duration,
      agreement_date: malaysiaToday(),
      tenant_signature: "[Pending tenant signature]",
    },
  );

  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .insert({
      tenancy_id: tenancy.id,
      template_id: template?.id ?? null,
      agreement_type: "original",
      version_number: 1,
      status: "draft",
      rendered_content: rendered,
      term_start_date: startDate,
      term_end_date: endDate,
      tenant_name_snapshot: tenant?.full_name ?? null,
      property_name_snapshot: property?.name ?? null,
      room_name_snapshot: room?.room_number ?? room?.name ?? null,
      created_by: userId,
    })
    .select("id")
    .single();

  return agreement?.id ?? null;
}
