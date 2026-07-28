export const AGREEMENT_TYPES = [
  {
    value: "residential_room",
    label: "Residential Room Tenancy Agreement",
    shortLabel: "Residential Room",
  },
  {
    value: "commercial_office",
    label: "Commercial Office Room Lease Agreement",
    shortLabel: "Commercial Office",
  },
] as const;

export type AgreementDocumentType =
  (typeof AGREEMENT_TYPES)[number]["value"];

export type AgreementTenantDetails = {
  fullName?: string | null;
  identityNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  tenantType?: string | null;
  businessName?: string | null;
  businessRegistrationNumber?: string | null;
  registeredAddress?: string | null;
  authorisedRepresentativeName?: string | null;
  representativeIdentityNumber?: string | null;
  businessContactNumber?: string | null;
  businessEmail?: string | null;
};

export function isAgreementDocumentType(
  value: unknown,
): value is AgreementDocumentType {
  return AGREEMENT_TYPES.some((option) => option.value === value);
}

export function agreementTypeLabel(type: AgreementDocumentType) {
  return (
    AGREEMENT_TYPES.find((option) => option.value === type)?.label ??
    AGREEMENT_TYPES[0].label
  );
}

export function agreementTypeForProperty(
  isCommercial: boolean,
): AgreementDocumentType {
  return isCommercial ? "commercial_office" : "residential_room";
}

function valueOrDash(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || "-";
}

function residentialTenantDetails(tenant: AgreementTenantDetails) {
  return [
    "### Tenant Details",
    `Tenant Name: ${valueOrDash(tenant.fullName)}`,
    `IC / Passport: ${valueOrDash(tenant.identityNumber)}`,
    `Contact Number: ${valueOrDash(tenant.phone)}`,
    `Emergency Contact: ${valueOrDash(tenant.emergencyContactName)}`,
    `Emergency Contact Number: ${valueOrDash(tenant.emergencyContactPhone)}`,
  ].join("\n");
}

function commercialTenantDetails(tenant: AgreementTenantDetails) {
  const isCompany = tenant.tenantType === "company";
  return [
    "### Company / Business Tenant Details",
    `Tenant Type: ${isCompany ? "Company" : "Sole Proprietor / Enterprise"}`,
    `Company / Business Name: ${valueOrDash(tenant.businessName ?? tenant.fullName)}`,
    `Company / Business Registration Number: ${valueOrDash(tenant.businessRegistrationNumber)}`,
    `Registered Address: ${valueOrDash(tenant.registeredAddress)}`,
    `Authorised Representative: ${valueOrDash(tenant.authorisedRepresentativeName ?? tenant.fullName)}`,
    `Representative IC / Passport: ${valueOrDash(tenant.representativeIdentityNumber ?? tenant.identityNumber)}`,
    `Contact Number: ${valueOrDash(tenant.businessContactNumber ?? tenant.phone)}`,
    `Email: ${valueOrDash(tenant.businessEmail ?? tenant.email)}`,
  ].join("\n");
}

const residentialClauses = `### Residential Occupation
The Premises shall be used only as private residential accommodation by the approved Tenant. The Tenant shall not use the Premises for any business, unlawful activity or purpose that causes nuisance, danger or unreasonable disturbance.

### Subletting and Occupants
The Tenant shall not assign, sublet, licence or share possession of the Premises for payment. No person other than the approved Tenant and any occupant approved in writing may reside at the Premises.

### Visitors and Overnight Guests
Visitors remain the Tenant's responsibility and shall comply with the House Rules. Overnight stays are allowed only when the applicable property setting permits them and any required approval has been obtained.

### Cooking and Fire Safety
Cooking is allowed only where the property setting permits it and only in the designated area. Open flames, unsafe appliances and any activity creating an unreasonable fire, smoke or grease hazard are prohibited.

### Noise, Cleanliness, Smoking and Pets
The Tenant shall keep the room and common areas reasonably clean, dispose of refuse properly and avoid excessive noise. Smoking and pets are prohibited unless the applicable property setting expressly permits them.

### Keys, Access Cards and Smart Locks
Keys, cards, codes and smart-lock credentials are personal to the Tenant. They shall not be copied, transferred or altered. Loss or compromise shall be reported immediately.

### Furniture, Belongings and Inventory
The Tenant shall take reasonable care of the residential furniture and inventory recorded in Schedule 2. Personal belongings remain at the Tenant's risk except to the extent loss is caused by the Landlord's proven negligence.

### Check-in and Checkout
At check-in, the Tenant shall inspect the Premises and promptly report defects. At checkout, the Tenant shall return the Premises, keys and access devices in reasonably clean condition, fair wear and tear excepted.`;

const commercialClauses = `### Approved Business Activity
The Premises shall be used only for the business activity approved in writing by the Landlord. Office use is permitted; retail trading, public-facing sales or other activities require separate written approval.

### Legal and Building Compliance
The Business Tenant shall maintain all registrations, licences and approvals required for its activity, comply with building management rules and not conduct any illegal business from the Premises.

### Authorised Users and Office Capacity
Only employees, representatives and users authorised by the Business Tenant may access the Premises. The number of users shall not exceed the property setting or any lawful building capacity.

### Business Registration and Signboard
Registration of the business at the Premises and installation of any signboard require prior written approval. On termination, the Business Tenant shall promptly remove the registered address and any approved signboard.

### Renovation and Restoration
No partition, renovation, wiring, drilling or alteration may be carried out without written approval. Approved works must comply with safety requirements. The Business Tenant shall restore the Premises at checkout unless the Landlord agrees otherwise in writing.

### Electrical and Hazardous Activities
Electrical loads and equipment shall be safe and suitable for the Premises. Cryptocurrency mining, hazardous materials, flammable storage and any activity that overloads the electrical supply are prohibited.

### Office Conduct and Access
The Business Tenant shall control its staff and visitors, avoid obstruction and nuisance, protect access credentials and comply with reasonable security and common-area rules.

### Office Equipment and Inventory
The Business Tenant shall take reasonable care of the office equipment and inventory recorded in Schedule 2 and shall report damage or faults promptly.`;

function residentialSignatureBlock(tenant: AgreementTenantDetails) {
  return `### Landlord
For and on behalf of DEKEZ SDN BHD

[LANDLORD_SIGNATURE]

### Tenant
Name: ${valueOrDash(tenant.fullName)}
IC / Passport: ${valueOrDash(tenant.identityNumber)}

Tenant Signature:

[Pending tenant signature]

### Witness
Name: ______________________________
IC / Passport: _____________________
Signature: _________________________`;
}

function commercialSignatureBlock(tenant: AgreementTenantDetails) {
  return `### Landlord
For and on behalf of DEKEZ SDN BHD

[LANDLORD_SIGNATURE]

### Company / Business Tenant
Company / Business Name: ${valueOrDash(tenant.businessName ?? tenant.fullName)}
Registration Number: ${valueOrDash(tenant.businessRegistrationNumber)}

Company Stamp: ______________________________

### Authorised Representative
Name: ${valueOrDash(tenant.authorisedRepresentativeName ?? tenant.fullName)}
IC / Passport: ${valueOrDash(tenant.representativeIdentityNumber ?? tenant.identityNumber)}

Authorised Representative Signature:

[Pending tenant signature]

### Witness
Name: ______________________________
IC / Passport: _____________________
Signature: _________________________`;
}

export function agreementTypeVariables(
  agreementType: AgreementDocumentType,
  tenant: AgreementTenantDetails,
) {
  const residential = agreementType === "residential_room";

  return {
    agreement_title: residential
      ? "RESIDENTIAL ROOM TENANCY AGREEMENT"
      : "COMMERCIAL OFFICE ROOM LEASE AGREEMENT",
    tenant_party_details: residential
      ? residentialTenantDetails(tenant)
      : commercialTenantDetails(tenant),
    permitted_use_clause: residential
      ? "Residential accommodation only."
      : "Commercial office use only, limited to the approved business activity and subject to written approval.",
    agreement_specific_clauses: residential
      ? residentialClauses
      : commercialClauses,
    signature_parties: residential
      ? residentialSignatureBlock(tenant)
      : commercialSignatureBlock(tenant),
    utility_usage_context: residential
      ? "Tenant residential utility usage"
      : "Business electricity and utility consumption",
  };
}
