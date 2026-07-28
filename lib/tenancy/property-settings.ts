import type { SupabaseClient } from "@supabase/supabase-js";

export const PROPERTY_TYPES = [
  { value: "residential_room", label: "Residential Room" },
  { value: "whole_house", label: "Whole House" },
  { value: "office", label: "Office" },
  { value: "shop_lot", label: "Shop Lot" },
] as const;

export const FACILITY_OPTIONS = [
  { code: "wifi", label: "WiFi" },
  { code: "water", label: "Water" },
  { code: "electricity", label: "Electricity" },
  { code: "air_conditioner", label: "Air Conditioner" },
  { code: "parking", label: "Parking" },
  { code: "water_heater", label: "Water Heater" },
  { code: "washing_machine", label: "Washing Machine" },
  { code: "refrigerator", label: "Refrigerator" },
  { code: "microwave", label: "Microwave" },
  { code: "kitchen_access", label: "Kitchen Access" },
  { code: "cooking_allowed", label: "Cooking Allowed" },
  { code: "cleaning_service", label: "Cleaning Service" },
  { code: "furniture", label: "Furniture" },
  { code: "mattress", label: "Mattress" },
  { code: "bed_frame", label: "Bed Frame" },
  { code: "wardrobe", label: "Wardrobe" },
  { code: "table", label: "Table" },
  { code: "chair", label: "Chair" },
  { code: "ceiling_fan", label: "Ceiling Fan" },
  { code: "smart_lock", label: "Smart Lock" },
  { code: "access_card", label: "Access Card" },
  { code: "mail_box", label: "Mail Box" },
] as const;

export const OPTIONAL_CLAUSES = [
  {
    code: "pets_allowed",
    label: "Pets Allowed",
    title: "Pets",
    text: "Pets are permitted only with the Landlord's written approval. The Tenant remains responsible for cleanliness, nuisance and damage caused by any approved pet.",
  },
  {
    code: "smoking_allowed",
    label: "Smoking Allowed",
    title: "Smoking",
    text: "Smoking is permitted only in an area expressly designated by the Landlord and remains prohibited inside bedrooms and enclosed common areas.",
  },
  {
    code: "visitors_overnight",
    label: "Visitors Overnight",
    title: "Overnight Visitors",
    text: "Overnight visitors are permitted subject to the House Rules. The Tenant remains responsible for every visitor and must obtain written approval for an extended stay.",
  },
  {
    code: "cooking_allowed",
    label: "Cooking Allowed",
    title: "Cooking",
    text: "Cooking is permitted only in the designated cooking area. The Tenant shall clean the area after use and shall not create a fire, smoke or grease hazard.",
  },
  {
    code: "parking",
    label: "Parking",
    title: "Parking",
    text: "Parking is permitted only in the bay or area assigned by the Landlord. Parking rights are not transferable and do not extend to abandoned or unroadworthy vehicles.",
  },
  {
    code: "business_registration",
    label: "Business Registration",
    title: "Business Registration",
    text: "Use of the address for business registration requires prior written approval and valid supporting documents. Approval ends when this tenancy ends.",
  },
  {
    code: "office_use",
    label: "Office Use",
    title: "Office Use",
    text: "The Premises may be used for the approved office activity only and not for residential occupation, unlawful trade, excessive customer traffic or hazardous storage.",
  },
  {
    code: "internet_included",
    label: "Internet Included",
    title: "Internet",
    text: "Shared internet access is included where available. Speed and uninterrupted availability depend on the third-party service provider and are not guaranteed.",
  },
  {
    code: "cleaning_included",
    label: "Cleaning Included",
    title: "Cleaning",
    text: "Cleaning is included only for the areas and frequency notified by the Landlord. The Tenant remains responsible for ordinary cleanliness inside the rented Premises.",
  },
  {
    code: "security_access",
    label: "Security Access",
    title: "Security Access",
    text: "The Tenant shall keep all security credentials confidential and shall promptly report any loss, misuse or suspected compromise.",
  },
  {
    code: "smart_lock",
    label: "Smart Lock",
    title: "Smart Lock",
    text: "The smart lock and its credentials shall not be altered, copied or transferred. Lost or compromised access may be replaced or reprogrammed at the Tenant's reasonable evidenced cost.",
  },
  {
    code: "cctv",
    label: "CCTV",
    title: "CCTV",
    text: "CCTV may operate in entrances and common areas for safety and property protection. CCTV shall not be installed inside the Tenant's private rented space.",
  },
  {
    code: "common_area_access",
    label: "Common Area Access",
    title: "Common Areas",
    text: "The Tenant may use designated common areas on a non-exclusive basis and shall keep them unobstructed, clean and reasonably quiet.",
  },
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number]["value"];
export type FacilityCode = (typeof FACILITY_OPTIONS)[number]["code"];
export type OptionalClauseCode = (typeof OPTIONAL_CLAUSES)[number]["code"];
export type UtilityMode = "included" | "tenant_pays" | "smart_meter";
export type AirConditionerMode =
  | "included"
  | "smart_meter"
  | "monthly_free_quota"
  | "none";

export type PropertyInventoryItem = {
  name: string;
  quantity: number;
  notes: string;
};

export type PropertyTenancySettings = {
  propertyType: PropertyType;
  facilities: Record<FacilityCode, boolean>;
  waterMode: UtilityMode;
  electricityMode: UtilityMode;
  airConditionerMode: AirConditionerMode;
  airConditionerFreeQuotaKwh: number | null;
  optionalClauses: Record<OptionalClauseCode, boolean>;
  inventory: PropertyInventoryItem[];
  emergencyContactName: string;
  emergencyContactPhone: string;
  keyHandoverNotes: string;
};

type RawSettings = {
  property_type?: unknown;
  facilities?: unknown;
  water_mode?: unknown;
  electricity_mode?: unknown;
  air_conditioner_mode?: unknown;
  air_conditioner_free_quota_kwh?: unknown;
  optional_clauses?: unknown;
  inventory?: unknown;
  emergency_contact_name?: unknown;
  emergency_contact_phone?: unknown;
  key_handover_notes?: unknown;
} | null;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isPropertyType(value: unknown): value is PropertyType {
  return PROPERTY_TYPES.some((option) => option.value === value);
}

function isUtilityMode(value: unknown): value is UtilityMode {
  return ["included", "tenant_pays", "smart_meter"].includes(String(value));
}

function isAirConditionerMode(value: unknown): value is AirConditionerMode {
  return ["included", "smart_meter", "monthly_free_quota", "none"].includes(
    String(value),
  );
}

export function defaultPropertyTenancySettings(
  isCommercial = false,
): PropertyTenancySettings {
  const facilities = Object.fromEntries(
    FACILITY_OPTIONS.map((option) => [option.code, false]),
  ) as Record<FacilityCode, boolean>;
  const optionalClauses = Object.fromEntries(
    OPTIONAL_CLAUSES.map((option) => [option.code, false]),
  ) as Record<OptionalClauseCode, boolean>;

  return {
    propertyType: isCommercial ? "shop_lot" : "residential_room",
    facilities: {
      ...facilities,
      water: true,
      electricity: true,
      air_conditioner: true,
      ceiling_fan: true,
      smart_lock: true,
    },
    waterMode: "included",
    electricityMode: "included",
    airConditionerMode: "smart_meter",
    airConditionerFreeQuotaKwh: null,
    optionalClauses: {
      ...optionalClauses,
      internet_included: true,
      security_access: true,
      smart_lock: true,
      common_area_access: !isCommercial,
    },
    inventory: [],
    emergencyContactName: "",
    emergencyContactPhone: "",
    keyHandoverNotes: "",
  };
}

export function normalizePropertyTenancySettings(
  raw: RawSettings,
  isCommercial = false,
): PropertyTenancySettings {
  const defaults = defaultPropertyTenancySettings(isCommercial);
  if (!raw) return defaults;

  const rawFacilities = objectValue(raw.facilities);
  const rawClauses = objectValue(raw.optional_clauses);
  const inventory = Array.isArray(raw.inventory)
    ? raw.inventory
        .map((item) => objectValue(item))
        .map((item) => ({
          name: stringValue(item.name),
          quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
          notes: stringValue(item.notes),
        }))
        .filter((item) => item.name)
    : [];
  const quota = Number(raw.air_conditioner_free_quota_kwh);

  return {
    propertyType: isPropertyType(raw.property_type)
      ? raw.property_type
      : defaults.propertyType,
    facilities: Object.fromEntries(
      FACILITY_OPTIONS.map((option) => [
        option.code,
        typeof rawFacilities[option.code] === "boolean"
          ? rawFacilities[option.code]
          : defaults.facilities[option.code],
      ]),
    ) as Record<FacilityCode, boolean>,
    waterMode: isUtilityMode(raw.water_mode)
      ? raw.water_mode
      : defaults.waterMode,
    electricityMode: isUtilityMode(raw.electricity_mode)
      ? raw.electricity_mode
      : defaults.electricityMode,
    airConditionerMode: isAirConditionerMode(raw.air_conditioner_mode)
      ? raw.air_conditioner_mode
      : defaults.airConditionerMode,
    airConditionerFreeQuotaKwh:
      Number.isFinite(quota) && quota >= 0 ? quota : null,
    optionalClauses: Object.fromEntries(
      OPTIONAL_CLAUSES.map((option) => [
        option.code,
        typeof rawClauses[option.code] === "boolean"
          ? rawClauses[option.code]
          : defaults.optionalClauses[option.code],
      ]),
    ) as Record<OptionalClauseCode, boolean>,
    inventory,
    emergencyContactName: stringValue(raw.emergency_contact_name),
    emergencyContactPhone: stringValue(raw.emergency_contact_phone),
    keyHandoverNotes: stringValue(raw.key_handover_notes),
  };
}

export async function loadPropertyTenancySettings(
  supabase: SupabaseClient,
  propertyId: string,
  isCommercial = false,
) {
  const { data } = await supabase
    .from("property_tenancy_settings")
    .select(
      "property_type, facilities, water_mode, electricity_mode, air_conditioner_mode, air_conditioner_free_quota_kwh, optional_clauses, inventory, emergency_contact_name, emergency_contact_phone, key_handover_notes",
    )
    .eq("property_id", propertyId)
    .maybeSingle();

  return normalizePropertyTenancySettings(data as RawSettings, isCommercial);
}

function propertyTypeWording(type: PropertyType) {
  const wording: Record<PropertyType, string> = {
    residential_room:
      "The Premises comprise the identified private room together with non-exclusive use of the common areas and facilities expressly included in this Agreement. No tenancy of the entire property is granted.",
    whole_house:
      "The Premises comprise the whole residential property identified in this Agreement, including the fixtures and facilities listed in the Inventory Checklist.",
    office:
      "The Premises are let for the approved office activity only. Residential occupation, retail trading, hazardous storage and any unlawful use are prohibited.",
    shop_lot:
      "The Premises are let as an approved commercial shop lot. The Tenant is responsible for licences, registrations and approvals required for the approved business activity.",
  };
  return wording[type];
}

function permittedUse(type: PropertyType) {
  const wording: Record<PropertyType, string> = {
    residential_room:
      "Private residential occupation by the approved Tenant only.",
    whole_house:
      "Private residential occupation of the whole house by the approved Tenant and permitted occupants only.",
    office: "Approved office use only. Residential occupation is prohibited.",
    shop_lot:
      "Approved commercial shop-lot use only, subject to the required licences and approvals.",
  };
  return wording[type];
}

function facilityStatus(included: boolean) {
  return included ? "Included in Monthly Rental" : "Not Included";
}

function utilityStatus(mode: UtilityMode) {
  if (mode === "included") return "Included in Monthly Rental";
  if (mode === "smart_meter") return "Charged According to Smart Meter";
  return "Tenant Pays Separately";
}

function airConditionerStatus(settings: PropertyTenancySettings) {
  if (settings.airConditionerMode === "none") return "Not Available";
  if (settings.airConditionerMode === "included") {
    return "Included in Monthly Rental";
  }
  if (settings.airConditionerMode === "monthly_free_quota") {
    return `Charged According to Smart Meter with ${(
      settings.airConditionerFreeQuotaKwh ?? 0
    ).toFixed(2)} kWh Monthly Free Quota`;
  }
  return "Charged According to Smart Meter";
}

function utilityClause(
  label: string,
  mode: UtilityMode,
) {
  if (mode === "included") {
    return `### ${label}\n${label} is included in the Rent, subject to reasonable use and the capacity of the property's shared supply.`;
  }
  if (mode === "smart_meter") {
    return `### ${label}\n${label} is measured through the assigned smart meter. Charges are based on recorded usage and the applicable rate shown on the Tenant's bill. The Tenant shall not tamper with, bypass or obstruct the meter.`;
  }
  return `### ${label}\nThe Tenant shall pay the ${label.toLowerCase()} charge allocated or invoiced for the Premises by the due date stated on the bill.`;
}

function airConditionerClause(settings: PropertyTenancySettings) {
  if (settings.airConditionerMode === "none") {
    return "### Air Conditioner\nNo air conditioner is included with the Premises.";
  }
  if (settings.airConditionerMode === "included") {
    return "### Air Conditioner\nReasonable air-conditioner use is included in the Rent. The Tenant shall use the equipment responsibly and promptly report faults.";
  }
  if (settings.airConditionerMode === "monthly_free_quota") {
    const quota = settings.airConditionerFreeQuotaKwh ?? 0;
    return `### Air Conditioner\nAir-conditioner electricity is measured by smart meter. A monthly free quota of ${quota.toFixed(2)} kWh is included. Usage above that quota is billed at the applicable rate shown on the Tenant's utility bill.`;
  }
  return "### Air Conditioner\nAir-conditioner electricity is measured by smart meter and billed from the recorded usage at the applicable rate. The Tenant shall not tamper with or bypass the meter.";
}

function keyHandoverItems(settings: PropertyTenancySettings) {
  const items: string[] = [];
  if (settings.facilities.smart_lock) {
    items.push("- Smart lock credential | Issued: ______ | Returned: ______");
  }
  if (settings.facilities.access_card) {
    items.push("- Access card | Quantity: ______ | Returned: ______");
  }
  if (settings.facilities.mail_box) {
    items.push("- Mail box key | Quantity: ______ | Returned: ______");
  }
  if (!items.length) {
    items.push("- Room or property key | Quantity: ______ | Returned: ______");
  }
  return items.join("\n");
}

export function propertyAgreementVariables(
  settings: PropertyTenancySettings,
) {
  const type = PROPERTY_TYPES.find(
    (option) => option.value === settings.propertyType,
  );
  const facilities = FACILITY_OPTIONS.map((option) => {
    const marker = settings.facilities[option.code]
      ? "[INCLUDED]"
      : "[NOT INCLUDED]";
    return `- ${marker} ${option.label}`;
  }).join("\n");
  const clauses = OPTIONAL_CLAUSES.filter(
    (clause) => settings.optionalClauses[clause.code],
  )
    .map((clause) => `### ${clause.title}\n${clause.text}`)
    .join("\n\n");
  const inventory = settings.inventory.length
    ? settings.inventory
        .map(
          (item) =>
            `- [ ] ${item.quantity} x ${item.name}${
              item.notes ? ` - ${item.notes}` : ""
            }`,
        )
        .join("\n")
    : "- No property inventory items have been assigned.";
  const inventoryNames = settings.inventory.length
    ? settings.inventory.map((item) => item.name).join(", ")
    : "See Schedule 2";
  const inventoryQuantity = settings.inventory.length
    ? String(
        settings.inventory.reduce(
          (total, item) => total + item.quantity,
          0,
        ),
      )
    : "-";
  const inventoryCondition =
    settings.inventory
      .map((item) => item.notes)
      .filter(Boolean)
      .join("; ") || "As recorded at check-in";
  const enabledClauseLabels = OPTIONAL_CLAUSES.filter(
    (clause) => settings.optionalClauses[clause.code],
  ).map((clause) => clause.label);
  const smartMeterEnabled =
    settings.waterMode === "smart_meter" ||
    settings.electricityMode === "smart_meter" ||
    ["smart_meter", "monthly_free_quota"].includes(
      settings.airConditionerMode,
    );
  const cookingAllowed =
    settings.facilities.cooking_allowed ||
    settings.optionalClauses.cooking_allowed;

  return {
    property_type: type?.label ?? "Residential Room",
    permitted_use: permittedUse(settings.propertyType),
    property_type_clause: propertyTypeWording(settings.propertyType),
    facility_matrix: facilities,
    utility_clauses: [
      utilityClause("Water", settings.waterMode),
      utilityClause("Electricity", settings.electricityMode),
      airConditionerClause(settings),
    ].join("\n\n"),
    optional_house_rules:
      clauses || "No optional property permissions are enabled.",
    inventory_checklist: inventory,
    emergency_contact_name:
      settings.emergencyContactName || "DEKEZ Management",
    emergency_contact_phone:
      settings.emergencyContactPhone || "Registered DEKEZ support channel",
    emergency_contact_relationship: "-",
    key_handover_items: keyHandoverItems(settings),
    key_handover_notes: settings.keyHandoverNotes || "-",
    wifi_status: facilityStatus(settings.facilities.wifi),
    water_status: utilityStatus(settings.waterMode),
    electricity_status: utilityStatus(settings.electricityMode),
    aircond_status: airConditionerStatus(settings),
    smart_meter_status: smartMeterEnabled
      ? "Smart Meter"
      : "Not Included",
    parking_status: facilityStatus(settings.facilities.parking),
    kitchen_status: facilityStatus(settings.facilities.kitchen_access),
    cooking_status: cookingAllowed ? "Allowed" : "Not Allowed",
    washing_machine_status: facilityStatus(
      settings.facilities.washing_machine,
    ),
    refrigerator_status: facilityStatus(settings.facilities.refrigerator),
    water_heater_status: facilityStatus(settings.facilities.water_heater),
    cleaning_status: facilityStatus(
      settings.facilities.cleaning_service ||
        settings.optionalClauses.cleaning_included,
    ),
    smart_lock_status: facilityStatus(settings.facilities.smart_lock),
    access_card_status: facilityStatus(settings.facilities.access_card),
    visitor_status: "Allowed subject to the House Rules",
    overnight_visitor_status: settings.optionalClauses.visitors_overnight
      ? "Allowed subject to prior approval"
      : "Not Allowed",
    pet_status: settings.optionalClauses.pets_allowed
      ? "Allowed subject to prior approval"
      : "Not Allowed",
    smoking_status: settings.optionalClauses.smoking_allowed
      ? "Allowed only in a designated area"
      : "Not Allowed",
    inventory_item: inventoryNames,
    quantity: inventoryQuantity,
    condition: inventoryCondition,
    replacement_cost: "0.00",
    electricity_rate: "0.00",
    electricity_free_quota_kwh:
      settings.airConditionerMode === "monthly_free_quota"
        ? (settings.airConditionerFreeQuotaKwh ?? 0).toFixed(2)
        : "No Free Quota",
    electricity_free_quota_amount: "0.00",
    smart_meter_rate: "As stated on the applicable utility bill",
    utility_quota:
      settings.airConditionerMode === "monthly_free_quota"
        ? `${(settings.airConditionerFreeQuotaKwh ?? 0).toFixed(2)} kWh`
        : "No Free Quota",
    special_conditions: enabledClauseLabels.length
      ? enabledClauseLabels.join(", ")
      : "None",
    room_key_quantity: "1",
    main_key_quantity: "0",
    access_card_quantity: settings.facilities.access_card ? "1" : "0",
    smart_lock_access: settings.facilities.smart_lock
      ? "Enabled"
      : "Not Included",
  };
}
