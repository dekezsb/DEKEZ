export const STANDARD_AGREEMENT_NAME = "DEKEZ Master Tenancy Agreement";
export const STANDARD_AGREEMENT_VERSION = 4;

export const standardAgreementTemplate = `# DEKEZ MASTER TENANCY AGREEMENT

Agreement Date: {{agreement_date}}

This Agreement records one tenancy term only. A renewal creates a new agreement and does not replace any earlier signed term.

## 1. LANDLORD DETAILS

Company Name: DEKEZ SDN BHD
Company Registration No. (New): 202501054747
Authorised Representative: Director of DEKEZ
NRIC No: 950222-12-5502

The company named above is referred to in this Agreement as the "Landlord".

## 2. TENANT DETAILS

Tenant Name: {{tenant_name}}
IC / Passport No: {{tenant_ic_passport}}
Phone / WhatsApp: {{tenant_phone}}

The person or entity named above is referred to in this Agreement as the "Tenant".

## 3. PROPERTY DETAILS

Property: {{property_name}}
Property Type: {{property_type}}
Room / Premises: {{room_number}}
Full Address: {{premise_address}}

{{property_type_clause}}

The Landlord agrees to let and the Tenant agrees to rent the Premises for the Term and on the conditions recorded in this Agreement.

## 4. RENTAL INFORMATION

Commencement Date: {{tenancy_start_date}}
Termination Date: {{tenancy_end_date}}
Duration: {{contract_duration_months}} months
Monthly Rent: {{monthly_rent}}
First Payment Due Date: {{first_payment_due_date}}

Rent is payable monthly in advance on the recurring due date recorded for this tenancy. Payment shall be made to DEKEZ SDN BHD, Public Bank Berhad, Account No. 3247421720, or another account notified by the Landlord in writing.

Payment is treated as made only when cleared funds are received and verified. Uploading a payment slip does not by itself discharge the amount due. The Tenant shall retain proof of payment and identify the room and rental month where possible.

Acceptance of a late or partial payment does not waive any later breach. Rent shall not be withheld or deducted unless permitted by law or agreed in writing.

## 5. DEPOSIT INFORMATION

Deposit Amount: {{deposit_amount}}

The Deposit secures the Tenant's obligations throughout this tenancy. Unless a different treatment is recorded in writing, it is not refundable in cash and may be credited against the final month's Rent only after the Tenant completes the Term, gives the required notice, returns vacant possession, returns all access devices and settles all outstanding sums.

Before applying any remaining balance, the Landlord may deduct unpaid Rent, properly evidenced utility charges, replacement or reprogramming costs for missing access devices, reasonable cleaning or removal costs, and reasonable repair or reinstatement costs for Tenant-caused damage, fair wear and tear excepted.

The Landlord shall provide an itemised statement for deductions. If the permitted deductions equal or exceed the Deposit, no final-month credit remains and the Tenant shall pay any evidenced shortfall within seven (7) days after written demand.

## 6. INCLUDED FACILITIES

The status below is taken from the Property Settings in force when this agreement was generated:

{{facility_matrix}}

An item marked Not Included is not promised as part of the Rent. An included shared facility is subject to reasonable use, availability and the applicable House Rules.

## 7. UTILITIES

{{utility_clauses}}

Utility charges must be supported by a bill, meter record or reasonable allocation. An undisputed utility invoice is payable by its stated due date. Essential services shall not be disconnected as a method of unlawful eviction.

## 8. HOUSE RULES

- Pay Rent and every properly payable charge on time.
- Keep the Premises reasonably clean and tenantable and dispose of refuse correctly.
- Do not assign, sublet, advertise, license or part with possession of the Premises.
- Do not conduct an unlawful activity, create a nuisance, harass another occupant or store dangerous material.
- Quiet hours are between 10:00 p.m. and 8:00 a.m.
- Do not alter wiring, plumbing, walls, fixtures, locks, meters or access systems without written approval.
- Promptly report leaks, electrical or plumbing faults, safety hazards, pest issues, damage and lost access credentials.
- The Tenant is responsible for visitors and for damage caused by the Tenant or visitors, fair wear and tear excepted.
- Permit lawful access after reasonable notice for inspection, repair, maintenance, meter reading, safety work or a genuine emergency.
- At the end of the tenancy, remove all belongings, return all access devices and leave the Premises reasonably clean.

The following property-specific permissions apply only because they were enabled in Property Settings:

{{optional_house_rules}}

## 9. RENEWAL AND TERMINATION

The Tenant may request renewal before expiry. Renewal is subject to written approval, agreement on the new Rent and terms, and execution of a new agreement. There is no automatic right to renew.

Every approved renewal is a separate tenancy term with its own agreement and signatures. An earlier signed agreement remains permanently in the tenancy history.

Either Party may terminate for a material breach that remains unremedied seven (7) days after written notice where the breach can be remedied. A shorter reasonable period may be stated for serious danger, violence, illegality, deliberate damage, harassment or substantial nuisance.

The Parties may end the tenancy by written mutual agreement. If the Tenant leaves early without a contractual or legal right, the Tenant remains responsible for the Landlord's reasonable loss, subject to the Landlord taking reasonable steps to reduce that loss.

After lawful possession is recovered, the Landlord may secure and re-let the Premises and may inventory and store belongings for a reasonable period after notice. The Landlord shall not unlawfully evict the Tenant, disable access, remove belongings or disconnect essential services.

This Agreement is governed by the laws of Malaysia applicable in Sabah. A dispute shall first be addressed through good-faith negotiation. If it is not resolved, either Party may commence proceedings before a court of competent jurisdiction in Sabah.

If any provision is unlawful or unenforceable, it shall be read down or severed only to the minimum extent necessary without affecting the remaining provisions.

## 10. INVENTORY CHECKLIST

The following inventory belongs to the property and is recorded for this tenancy:

{{inventory_checklist}}

The Tenant shall inspect the listed items at handover and report a material discrepancy within forty-eight (48) hours. Dated photographs and condition records may form part of this Agreement.

## 11. EMERGENCY CONTACT

Contact Name: {{emergency_contact_name}}
Phone / Contact Channel: {{emergency_contact_phone}}

The Tenant shall use the emergency contact for urgent safety, water, electrical, access or property-protection matters. Non-urgent repairs should be submitted through the DEKEZ portal.

## 12. SIGNATURES

For and on behalf of the Landlord:

Company Name: DEKEZ SDN BHD
Company Registration No. (New): 202501054747
Authorised Representative: Director of DEKEZ
NRIC No: 950222-12-5502

Authorised Signature and Company Chop:

[LANDLORD_SIGNATURE]

For and on behalf of the Tenant:

Name: {{tenant_name}}
IC / Passport No: {{tenant_ic_passport}}

Tenant Signature:

{{tenant_signature}}

[TENANT_DOCUMENT_APPENDIX]

## 14. KEY HANDOVER

Handover Date: ____________________

{{key_handover_items}}

Additional Handover Notes: {{key_handover_notes}}

Opening Meter Reading, if applicable: ____________________
Closing Meter Reading, if applicable: ____________________

The Tenant acknowledges receipt of the access items recorded above and agrees to return them at checkout. Missing or damaged access items may be charged at the reasonable evidenced replacement or reprogramming cost.

Tenant Initial: ____________________
DEKEZ Representative Initial: ____________________
`;
