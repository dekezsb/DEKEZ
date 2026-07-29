export const masterAgreementTemplate = `# {{agreement_title}}

Agreement Date: {{agreement_date}}

This Agreement is made between DEKEZ SDN BHD (Company Registration No. (New): 202501054747), whose correspondence address is {{landlord_address}} ("Landlord"), and the tenant identified below ("Tenant").

## 1. LANDLORD AND TENANT DETAILS

### Landlord Details
Company Name: DEKEZ SDN BHD
Company Registration No. (New): 202501054747
Authorised Representative: {{landlord_representative_name}}
Contact Address: {{landlord_address}}

{{tenant_party_details}}

## 2. PROPERTY AND ROOM DETAILS

Property: {{property_name}}
Property Code: {{property_code}}
Property Address: {{property_address}}
Room: {{room_number}}
Property Type: {{property_type}}

{{property_type_clause}}

## 3. TENANCY PERIOD

Term Start Date: {{tenancy_start_date}}
Term End Date: {{tenancy_end_date}}
Contract Duration: {{contract_duration_months}} month(s)

The Tenant may occupy the Premises only during the stated term unless the parties sign a renewal or extension.

## 4. RENTAL INFORMATION

Monthly Rent: RM {{monthly_rent}}
Recurring Due Day: {{rent_due_day}}
First Payment Due Date: {{first_payment_due_date}}

Rent shall be paid by the due date through an approved DEKEZ payment channel. A payment submission does not discharge the amount due until it has been verified and recorded.

## 5. DEPOSIT INFORMATION

Security Deposit: RM {{security_deposit}}
Utility Deposit: RM {{utility_deposit}}
Key Deposit: RM {{key_deposit}}
Other Deposit: RM {{other_deposit}}

Deposits are held as security and are not advance rent. Subject to deductions supported by records, the refundable balance will be processed within {{deposit_refund_days}} day(s) after checkout and final account reconciliation.

## 6. PERMITTED USE

{{permitted_use_clause}}

{{agreement_specific_clauses}}

## 7. INCLUDED FACILITIES

The following property-specific settings form part of this Agreement:

{{facility_matrix}}

Items marked Not Included are not promised or charged as included facilities under this Agreement.

## 8. UTILITIES

The following terms govern {{utility_usage_context}}:

{{utility_clauses}}

The Tenant shall pay separately billed utility charges by the stated due date and shall not tamper with any meter, wiring, supply or safety equipment.

## 9. LATE PAYMENT

An amount not received by its due date remains outstanding. DEKEZ may send reminders, restrict non-essential services where lawful, and take recovery action permitted by this Agreement and Malaysian law. Any late charge must be disclosed and lawfully applied.

## 10. MAINTENANCE AND DAMAGE

The Tenant shall keep the Premises reasonably clean, use all fixtures responsibly and report defects promptly. The Landlord remains responsible for structural or supplied-equipment repairs except where damage results from the Tenant, its occupants, staff, visitors or contractors.

## 11. ACCESS

The Landlord or its authorised management team may enter on reasonable notice to inspect, repair, maintain, show or protect the Premises. Immediate access is permitted where reasonably necessary for an emergency, safety risk or serious breach.

## 12. PROPERTY-SPECIFIC OPTIONAL CLAUSES

Only the following enabled property clauses apply:

{{optional_house_rules}}

## 13. RENEWAL

Renewal is not automatic. A new term must be approved and recorded by DEKEZ. Unless changed in writing, the recurring rent due day remains the same for the renewed term.

## 14. TERMINATION AND CHECKOUT

The Tenant shall provide the required notice, settle all amounts, return access devices and complete checkout. Future charges stop only when the tenancy is formally closed or terminated in the DEKEZ system.

## 15. BREACH

A material breach includes non-payment, unauthorised use or occupants, serious nuisance, unlawful activity, prohibited alterations, false registration details or repeated failure to comply after written notice. The non-defaulting party may exercise remedies available under this Agreement and Malaysian law.

## 16. NOTICES

Notices may be delivered by hand, registered contact number, WhatsApp, email or the DEKEZ portal. Each party shall keep its contact details current.

## 17. GOVERNING LAW

This Agreement is governed by Malaysian law. The parties submit to the jurisdiction of the courts in Sabah, including the High Court in Sabah and Sarawak where applicable.

## SCHEDULE 1 - INCLUDED FACILITIES AND UTILITIES

{{facility_utility_schedule}}

## SCHEDULE 2 - INVENTORY CHECKLIST

{{inventory_checklist}}

The inventory condition shall be confirmed at handover. Missing or damaged items beyond fair wear and tear may be charged at reasonable replacement or repair cost.

## SCHEDULE 3 - KEY AND ACCESS HANDOVER

{{key_handover_items}}

Notes: {{key_handover_notes}}

## 18. SIGNATURES

By signing, each party confirms that it has read, understood and accepted this Agreement and its schedules.

{{signature_parties}}

[TENANT_DOCUMENT_APPENDIX]

## END OF AGREEMENT`;
