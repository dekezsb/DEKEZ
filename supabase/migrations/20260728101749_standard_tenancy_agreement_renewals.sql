create unique index if not exists tenancy_agreements_unique_term_idx
  on public.tenancy_agreements (tenancy_id, term_start_date, term_end_date)
  where term_start_date is not null and term_end_date is not null;

create unique index if not exists tenancy_agreement_templates_standard_v2_idx
  on public.tenancy_agreement_templates (property_id, name, version)
  where property_id is not null
    and name = 'DEKEZ Standard Room Tenancy Agreement'
    and version = 2;

insert into public.tenancy_agreement_templates (
  property_id,
  name,
  template_content,
  version,
  is_active,
  created_by
)
select
  properties.id,
  'DEKEZ Standard Room Tenancy Agreement',
  $dekez_template$# TENANCY AGREEMENT

DATED THIS {{agreement_date}}

BETWEEN

DEKEZ SDN BHD
Company No: 202501054747
(LANDLORD / CHIEF TENANT)

AND

Name: {{tenant_name}}
IC / Passport No: {{tenant_ic_passport}}
Phone: {{tenant_phone}}
(TENANT)

## PREMISES

Property: {{property_name}}
Room: {{room_number}}
Premise Address: {{premise_address}}

This Tenancy Agreement ("Agreement") is made on the date stated above between the Landlord and the Tenant identified above. The Landlord agrees to let and the Tenant agrees to rent the Premises described above for the Term and subject to the terms and conditions set out in this Agreement.

## 1. RENTAL TERMS

Commencement Date: {{tenancy_start_date}}
Termination Date: {{tenancy_end_date}}
Duration of Tenancy: {{contract_duration_months}} months
Monthly Rent: {{monthly_rent}}

Each rental month begins on the monthly anniversary of the Commencement Date. The Rent for each rental month shall be paid monthly in advance within seven (7) calendar days after the beginning of that rental month.

For this tenancy commencing on {{tenancy_start_date}}, the first payment is due no later than {{first_payment_due_date}}, and each subsequent payment is due no later than seven (7) calendar days after the corresponding monthly anniversary date.

Payment shall be made to DEKEZ SDN BHD, Public Bank Berhad, Account No. 3247421720, or another account notified by the Landlord in writing.

Payment is treated as made only when cleared funds are received. The Tenant shall retain proof of payment, identify the room and rental month where possible, and bear any bank charge caused by a failed or reversed payment.

Rent shall not be withheld or deducted unless permitted by law or agreed in writing. Acceptance of late or partial payment does not waive a later breach.

## 2. DEPOSIT

Non-Refundable Deposit: {{deposit_amount}}, payable before possession and held as security for the Tenant's obligations throughout the tenancy. The Deposit is not refundable in cash and shall not be treated as advance Rent during the tenancy.

Provided that the Tenant completes the full Term, gives at least one (1) month's written notice before the Expiry Date, returns vacant possession, removes all belongings, returns all access devices and settles all outstanding sums, the balance of the Deposit remaining after the deductions stated below shall be credited against the final month's Rent. No cash refund shall be payable.

Before applying the balance to the final month's Rent, the Landlord may deduct unpaid Rent, air-conditioner electricity and other properly evidenced charges, reasonable replacement or reprogramming costs for missing access devices, reasonable cleaning or removal costs, and reasonable repair or reinstatement costs for damage caused by the Tenant or visitors, fair wear and tear excepted. The Landlord shall provide an itemised statement and, where reasonably available, supporting receipts, invoices, photographs or meter records.

If the permitted deductions equal or exceed the Deposit, no credit shall be available against the final month's Rent and the Tenant shall pay any evidenced shortfall within seven (7) days after written demand. If the Tenant leaves before completing the Term or otherwise loses the right to the final-month credit, the Landlord may apply the Deposit toward reasonable and legally recoverable loss arising from the breach, subject to applicable law.

## 3. TENANT RESPONSIBILITIES

- Pay Rent and all properly payable charges on time and provide truthful, current identification and contact information.
- Use the Premises only as the Tenant's private residence. Do not operate a business, short-term rental, hostel, unlawful activity or nuisance-causing activity from the Premises.
- Do not assign, sublet, license, advertise, share for payment or part with possession of the Premises, and do not give any unauthorised person a continuing access credential.
- Keep the Premises reasonably clean and tenantable, clean shared facilities after use, dispose of refuse properly and avoid obstructing entrances, exits, corridors and Common Areas.
- Be responsible for damage caused by the Tenant or visitors, but not for fair wear and tear, normal ageing, latent defects, structural failure or damage not caused by the Tenant.
- Do not create excessive noise, vibration, smoke, odour, fire risk, harassment or unreasonable interference. Quiet hours are between 10:00 p.m. and 8:00 a.m.
- Smoking and vaping are prohibited inside the Premises and Common Areas. No pet may be kept without the Landlord's prior written consent.
- Cook only in the designated kitchen. Do not pour grease, food waste, chemicals or obstructive material into sinks, toilets or drains.
- Do not store illegal, explosive or hazardous material other than ordinary household products safely kept in reasonable quantities.
- Do not alter wiring, plumbing, walls, fixtures, the smart lock, smart meter, wall fan, light or electrical sockets without prior written consent.
- Report promptly any leak, electrical or plumbing fault, structural damage, pest infestation, safety hazard, lost access credential, or fault affecting the smart lock, smart meter, light or wall fan. The Tenant is responsible for additional damage caused by unreasonable delay.
- The Tenant is responsible for visitors. A visitor shall not stay overnight for more than three (3) consecutive nights or six (6) nights in a calendar month without prior written consent.
- Treat other occupants, neighbours, employees and contractors respectfully and comply with the reasonable, lawful and consistently applied House Rules.
- Permit lawful access after the notice required by this Agreement and do not unreasonably obstruct inspection, repair, maintenance, meter reading, pest control or safety work.
- Insure personal money, documents, valuables and belongings against theft, fire, water damage and other risks.
- At the end of the tenancy, remove all belongings, return every access device, settle undisputed charges and return the Premises reasonably clean and tenantable, fair wear and tear excepted.
- Do not leave furniture, rubbish or personal belongings in the Common Areas or beside rubbish receptacles.

## 4. LANDLORD RESPONSIBILITIES

The Landlord shall permit the Tenant to occupy and enjoy the Premises without unlawful interference and maintain the authority and required consent to grant this tenancy.

The Landlord shall take reasonable steps to maintain the main structure, roof, external walls, main drains, water pipes, electrical supply and shared installations, except where repair is required because of the Tenant's act, negligence or misuse.

The Landlord shall address reported repairs within a period appropriate to their urgency and the availability of contractors or parts, maintain Common Areas under the Landlord's control, keep proper payment and deduction records, and comply with applicable law when enforcing this Agreement or recovering possession.

## 5. RENEWAL AND TERMINATION

The Tenant may request renewal at least two (2) months before expiry. Renewal is subject to written approval, agreement on new Rent and terms, and execution of a new agreement. There is no automatic right to renewal.

Every approved renewal is a separate tenancy term and must have its own agreement and signatures. An earlier signed agreement remains part of the permanent tenancy history and is not replaced by a renewal.

Either Party may terminate for a material breach that remains unremedied seven (7) days after written notice where the breach is capable of remedy. A shorter reasonable period may be stated for serious danger, violence, illegality, deliberate damage, harassment or substantial nuisance.

The Parties may end the tenancy by written mutual agreement. If the Tenant leaves early without a contractual or legal right, the Tenant remains liable for the Landlord's reasonable loss, but the Landlord shall take reasonable steps to reduce that loss, including seeking a replacement tenant.

## 6. UTILITIES AND AIR-CONDITIONER USAGE

Subject to reasonable residential use, water and ordinary electricity excluding air-conditioner electricity are provided without a separate monthly charge. Shared Wi-Fi is provided where available, without a guarantee of uninterrupted third-party service.

Air-conditioner electricity is measured by the smart meter. The Tenant receives a monthly allowance of RM50, calculated at RM0.57 per kilowatt-hour (approximately 87.72 kWh).

Usage above the allowance is charged at RM0.57 per kilowatt-hour. Each invoice shall state the billing period, opening and closing readings, total usage, allowance, excess usage and amount payable. An undisputed invoice is payable within seven (7) days. The Tenant shall not tamper with or bypass the smart meter. Essential services shall not be disconnected as a method of eviction.

## 7. ADDITIONAL TERMS

### Smart Lock, Access Credentials and Lockouts

The Landlord may retain administrator or emergency access solely for lawful entry. The Tenant shall keep access codes, cards and digital credentials secure and shall not copy, transfer or disclose them to an unauthorised person.

A lost, compromised or unreturned access device shall be replaced or reprogrammed at the Tenant's reasonable cost, capped at RM100 unless a higher actual cost is evidenced.

A lockout caused by the Tenant requiring the Landlord's attendance incurs RM50. If an external technician is reasonably required, the Tenant shall pay the actual reasonable charge.

A compromised credential may be deactivated for security, but a replacement access method shall be supplied as soon as reasonably practicable. The smart lock shall not be disabled as a method of unlawful eviction.

If an access device is stolen, the Tenant shall promptly notify the Landlord and make a police report where reasonably appropriate.

### Rent Arrears and Final Grace Period

If the Rent is not received within the initial seven (7) calendar days after the beginning of the relevant rental month, the Landlord may issue a written Notice of Rent Arrears granting the Tenant a final grace period of seven (7) additional calendar days to pay all outstanding Rent and applicable late-payment charges.

If full cleared payment is received within that final grace period, the notice shall be treated as satisfied and the Tenant's access shall continue, subject to any other breach.

### Failure to Pay After Final Grace Period

If full cleared payment is not received by the end of the additional seven (7)-day grace period, the Landlord may terminate the tenancy by written notice and pursue all lawful remedies, including recovery of Rent and reasonable compensation, distress proceedings where available, and court proceedings for possession.

The Landlord shall not disable the smart lock to deny access, remove or dispose of belongings, disconnect essential services, physically remove the Tenant, clear the Premises or re-let it while the Tenant remains in possession, except after the Tenant voluntarily surrenders vacant possession or pursuant to a lawful court order.

After lawful possession has been recovered, the Landlord may secure, clear and re-let the Premises and may inventory, remove and store belongings in accordance with this Agreement and applicable law.

### Complaints and Conduct

Other occupants may report misconduct or breach to the Landlord, but they have no authority to terminate this Agreement or evict the Tenant. Complaints shall be considered reasonably based on available evidence.

### Insurance

The Tenant is responsible for insuring personal belongings. The Landlord is not liable for loss of belongings unless caused by the Landlord's negligence, breach or unlawful act.

### Indemnity and Liability

The Tenant shall indemnify the Landlord against reasonable third-party claims arising directly from the Tenant's negligence, wilful misconduct or unlawful act, except to the extent caused or contributed to by the Landlord.

Nothing in this Agreement excludes liability that cannot lawfully be excluded. Neither Party is liable for remote or indirect loss except where required by law.

### Access

The Landlord or an authorised contractor may enter after at least twenty-four (24) hours' prior notice at a reasonable time to inspect, repair, maintain, read the meter, service the smart lock or show the Premises during the final sixty (60) days.

No prior notice is required in a genuine emergency where immediate entry is reasonably necessary to protect persons or property.

### Condition and Handover

The Appendix and dated photographs record visible condition. Unless the Tenant objects in writing within forty-eight (48) hours after handover, the visible condition record is accepted, without affecting rights concerning hidden defects. A joint exit inspection should be conducted and the closing smart-meter reading recorded.

### Restoration

Tenant-caused damage shall be repaired with prior written approval or paid at a reasonable evidenced cost. The Tenant shall not arrange a non-emergency repair at the Landlord's expense without approval.

### Entire Agreement

This Agreement, its schedules, the inventory, condition record and acknowledged House Rules constitute the entire agreement. No oral statement changes it. An amendment, concession or extension must be confirmed in writing by both Parties.

### Notices

A notice may be delivered by hand, registered post, email or WhatsApp to the latest notified details. Hand delivery is effective when delivered; registered post three (3) business days after posting; and electronic notice when successful delivery is shown unless a failure notice is received.

### Absence and Abandonment

The Tenant shall notify the Landlord if the Premises will be unoccupied for more than fourteen (14) consecutive days. Absence alone is not abandonment. The Landlord shall take reasonable steps to contact the Tenant and comply with applicable law before treating the Premises as abandoned or dealing with belongings.

### Belongings Left Behind

After lawful recovery or voluntary surrender, the Landlord may inventory and store belongings for a reasonable period after notice and recover reasonable removal and storage costs. Valuable property shall not be appropriated by the Landlord.

### Evidence

Subject to applicable law, payment records, photographs, videos, written communications, access logs, smart-meter records, invoices and condition reports may be used to establish payment, condition, usage, access, damage or breach.

### Tenant Acknowledgement

The Tenant confirms having inspected the Premises, read and understood this Agreement, the smart-meter arrangement and House Rules, received an opportunity to ask questions and obtain independent advice, and relied on no promise not recorded in writing. This does not waive any right that cannot lawfully be waived.

### Personal Information

Identity and contact information shall be used only to assess, manage or enforce the tenancy, collect payments, protect property and comply with legal obligations, and shall not be disclosed to unrelated persons except where required by law or reasonably necessary.

### Waiver and Severability

Delay in enforcing a right is not a waiver. If a provision is invalid or unenforceable, it shall be read down or severed to the minimum extent necessary without affecting the remaining provisions.

### Stamping and Costs

This Agreement shall be duly stamped within the period required by the Stamp Act 1949. Unless otherwise agreed, the Tenant bears applicable stamp duty and each Party bears its own advisory costs.

***

## GOVERNING LAW AND DISPUTE RESOLUTION

This Agreement shall be governed by and construed in accordance with the laws of Malaysia applicable in the State of Sabah.

Any dispute, claim or disagreement arising from this Agreement shall first be addressed through good-faith negotiation. The party raising the matter shall provide written notice setting out the relevant details and the resolution sought. The receiving party shall respond within seven (7) days of receiving such notice.

If the matter cannot be resolved amicably, either party may commence proceedings before a court of competent jurisdiction in Sabah. The parties submit to the jurisdiction of the courts in Sabah, including the High Court in Sabah and Sarawak, where applicable. This provision shall not prevent either party from seeking urgent interim relief or exercising any lawful remedy available under Malaysian law.

If any provision of this Agreement is held to be unlawful, invalid or unenforceable, it shall be modified or severed only to the extent necessary. The validity and enforceability of the remaining provisions shall not be affected.

## SIGNATURES

For and on behalf of the Landlord:

Company Name: DEKEZ SDN BHD
Authorised Representative: Director of DEKEZ
NRIC No: 950222-12-5502

Authorised Signature and Company Chop:

[LANDLORD_SIGNATURE]

For and on behalf of the Tenant:

Name: {{tenant_name}}
IC / Passport No: {{tenant_ic_passport}}

Tenant Signature:

{{tenant_signature}}

## APPENDIX

- Tenant IC or passport copy
- Commercial supporting document, where required
- Photos of the room and furniture
- Condition and handover records
$dekez_template$,
  2,
  true,
  properties.created_by
from public.properties
where not exists (
  select 1
  from public.tenancy_agreement_templates templates
  where templates.property_id = properties.id
    and templates.name = 'DEKEZ Standard Room Tenancy Agreement'
    and templates.version = 2
);

update public.properties properties
set
  default_ta_template_id = templates.id,
  default_contract_duration_months = case
    when properties.is_commercial then 12
    else 6
  end,
  updated_at = now()
from public.tenancy_agreement_templates templates
where templates.property_id = properties.id
  and templates.name = 'DEKEZ Standard Room Tenancy Agreement'
  and templates.version = 2
  and properties.default_ta_template_id is distinct from templates.id;

do $backfill$
declare
  tenancy_record record;
  template_record record;
  term_start date;
  term_end date;
  next_start date;
  next_end date;
  duration_months integer;
  renewal_months integer;
  v_agreement_id uuid;
  v_previous_agreement_id uuid;
  agreement_version integer;
  agreement_content text;
  agreement_state public.agreement_status;
begin
  for tenancy_record in
    select
      tenancies.*,
      tenants.full_name as tenant_name,
      tenants.phone as tenant_phone,
      tenants.identity_number as tenant_identity_number,
      properties.name as property_name,
      properties.address as property_address,
      properties.is_commercial,
      rooms.room_number,
      rooms.name as room_name
    from public.tenancies
    join public.tenants on tenants.id = tenancies.tenant_id
    join public.properties on properties.id = tenancies.property_id
    join public.rooms on rooms.id = tenancies.room_id
    where tenancies.status in ('active', 'ended')
      and coalesce(
        tenancies.check_in_date,
        tenancies.tenancy_start_date,
        tenancies.contract_start,
        tenancies.start_date
      ) is not null
  loop
    select id, template_content
    into template_record
    from public.tenancy_agreement_templates
    where property_id = tenancy_record.property_id
      and name = 'DEKEZ Standard Room Tenancy Agreement'
      and version = 2
    limit 1;

    term_start := coalesce(
      tenancy_record.check_in_date,
      tenancy_record.tenancy_start_date,
      tenancy_record.contract_start,
      tenancy_record.start_date
    );
    duration_months := coalesce(
      tenancy_record.contract_duration_months,
      case when tenancy_record.is_commercial then 12 else 6 end
    );
    term_end := coalesce(
      tenancy_record.checkout_date,
      tenancy_record.tenancy_end_date,
      tenancy_record.contract_end,
      tenancy_record.end_date,
      (term_start + make_interval(months => duration_months) - interval '1 day')::date
    );

    agreement_content := template_record.template_content;
    agreement_content := replace(agreement_content, '{{agreement_date}}', to_char(current_date, 'DD/MM/YYYY'));
    agreement_content := replace(agreement_content, '{{tenant_name}}', coalesce(tenancy_record.tenant_name, '-'));
    agreement_content := replace(agreement_content, '{{tenant_ic_passport}}', coalesce(tenancy_record.tenant_identity_number, '-'));
    agreement_content := replace(agreement_content, '{{tenant_phone}}', coalesce(tenancy_record.tenant_phone, '-'));
    agreement_content := replace(agreement_content, '{{property_name}}', coalesce(tenancy_record.property_name, '-'));
    agreement_content := replace(agreement_content, '{{room_number}}', coalesce(tenancy_record.room_number, tenancy_record.room_name, '-'));
    agreement_content := replace(agreement_content, '{{premise_address}}', coalesce(tenancy_record.property_address, '-'));
    agreement_content := replace(agreement_content, '{{monthly_rent}}', 'RM ' || to_char(coalesce(tenancy_record.monthly_rental, 0), 'FM999999990.00'));
    agreement_content := replace(agreement_content, '{{deposit_amount}}', 'RM ' || to_char(coalesce(tenancy_record.deposit, 0), 'FM999999990.00'));
    agreement_content := replace(agreement_content, '{{tenancy_start_date}}', to_char(term_start, 'DD/MM/YYYY'));
    agreement_content := replace(agreement_content, '{{tenancy_end_date}}', to_char(term_end, 'DD/MM/YYYY'));
    agreement_content := replace(agreement_content, '{{contract_duration_months}}', duration_months::text);
    agreement_content := replace(agreement_content, '{{first_payment_due_date}}', to_char(term_start + 7, 'DD/MM/YYYY'));
    agreement_content := replace(agreement_content, '{{tenant_signature}}', '[Pending tenant signature]');

    agreement_state := case
      when term_end < current_date then 'expired'::public.agreement_status
      else 'pending_signature'::public.agreement_status
    end;

    insert into public.tenancy_agreements (
      tenancy_id,
      template_id,
      agreement_type,
      version_number,
      status,
      rendered_content,
      term_start_date,
      term_end_date,
      tenant_name_snapshot,
      property_name_snapshot,
      room_name_snapshot,
      created_by
    )
    values (
      tenancy_record.id,
      template_record.id,
      'original',
      1,
      agreement_state,
      agreement_content,
      term_start,
      term_end,
      tenancy_record.tenant_name,
      tenancy_record.property_name,
      coalesce(tenancy_record.room_number, tenancy_record.room_name),
      tenancy_record.created_by
    )
    on conflict (tenancy_id, term_start_date, term_end_date)
      where term_start_date is not null and term_end_date is not null
    do nothing;

    select id, version_number
    into v_previous_agreement_id, agreement_version
    from public.tenancy_agreements
    where tenancy_id = tenancy_record.id
      and term_start_date = term_start
      and term_end_date = term_end
    limit 1;

    if tenancy_record.status = 'active'
      and tenancy_record.checkout_date is null
      and coalesce(tenancy_record.billing_status, 'active') not in ('terminated', 'completed')
    then
      renewal_months := case when tenancy_record.is_commercial then 12 else 6 end;

      while term_end <= current_date + 30 loop
        next_start := term_end + 1;
        next_end := (
          next_start + make_interval(months => renewal_months) - interval '1 day'
        )::date;
        agreement_version := agreement_version + 1;
        agreement_state := case
          when next_end < current_date then 'expired'::public.agreement_status
          else 'renewal_pending'::public.agreement_status
        end;

        agreement_content := template_record.template_content;
        agreement_content := replace(agreement_content, '{{agreement_date}}', to_char(current_date, 'DD/MM/YYYY'));
        agreement_content := replace(agreement_content, '{{tenant_name}}', coalesce(tenancy_record.tenant_name, '-'));
        agreement_content := replace(agreement_content, '{{tenant_ic_passport}}', coalesce(tenancy_record.tenant_identity_number, '-'));
        agreement_content := replace(agreement_content, '{{tenant_phone}}', coalesce(tenancy_record.tenant_phone, '-'));
        agreement_content := replace(agreement_content, '{{property_name}}', coalesce(tenancy_record.property_name, '-'));
        agreement_content := replace(agreement_content, '{{room_number}}', coalesce(tenancy_record.room_number, tenancy_record.room_name, '-'));
        agreement_content := replace(agreement_content, '{{premise_address}}', coalesce(tenancy_record.property_address, '-'));
        agreement_content := replace(agreement_content, '{{monthly_rent}}', 'RM ' || to_char(coalesce(tenancy_record.monthly_rental, 0), 'FM999999990.00'));
        agreement_content := replace(agreement_content, '{{deposit_amount}}', 'RM ' || to_char(coalesce(tenancy_record.deposit, 0), 'FM999999990.00'));
        agreement_content := replace(agreement_content, '{{tenancy_start_date}}', to_char(next_start, 'DD/MM/YYYY'));
        agreement_content := replace(agreement_content, '{{tenancy_end_date}}', to_char(next_end, 'DD/MM/YYYY'));
        agreement_content := replace(agreement_content, '{{contract_duration_months}}', renewal_months::text);
        agreement_content := replace(agreement_content, '{{first_payment_due_date}}', to_char(next_start + 7, 'DD/MM/YYYY'));
        agreement_content := replace(agreement_content, '{{tenant_signature}}', '[Pending tenant signature]');

        insert into public.tenancy_agreements (
          tenancy_id,
          template_id,
          agreement_type,
          version_number,
          status,
          rendered_content,
          term_start_date,
          term_end_date,
          tenant_name_snapshot,
          property_name_snapshot,
          room_name_snapshot,
          previous_agreement_id,
          created_by
        )
        values (
          tenancy_record.id,
          template_record.id,
          'renewal',
          agreement_version,
          agreement_state,
          agreement_content,
          next_start,
          next_end,
          tenancy_record.tenant_name,
          tenancy_record.property_name,
          coalesce(tenancy_record.room_number, tenancy_record.room_name),
          v_previous_agreement_id,
          tenancy_record.created_by
        )
        on conflict (tenancy_id, term_start_date, term_end_date)
          where term_start_date is not null and term_end_date is not null
        do nothing;

        select id, version_number
        into v_agreement_id, agreement_version
        from public.tenancy_agreements
        where tenancy_id = tenancy_record.id
          and term_start_date = next_start
          and term_end_date = next_end
        limit 1;

        insert into public.tenancy_renewals (
          tenancy_id,
          selected_duration_months,
          renewal_status,
          new_start_date,
          new_end_date,
          new_agreement_id,
          created_by
        )
        select
          tenancy_record.id,
          renewal_months,
          case
            when next_end < current_date then 'expired'
            else 'renewal_pending'
          end,
          next_start,
          next_end,
          v_agreement_id,
          tenancy_record.created_by
        where not exists (
          select 1
          from public.tenancy_renewals
          where new_agreement_id = v_agreement_id
        );

        v_previous_agreement_id := v_agreement_id;
        term_end := next_end;
      end loop;
    end if;

    select id, status
    into v_agreement_id, agreement_state
    from public.tenancy_agreements
    where tenancy_id = tenancy_record.id
      and status in ('pending_signature', 'renewal_pending', 'renewal_sent')
    order by term_end_date desc
    limit 1;

    if v_agreement_id is not null then
      insert into public.agreement_notifications (
        tenancy_id,
        agreement_id,
        notification_type,
        status,
        due_at
      )
      select
        tenancy_record.id,
        v_agreement_id,
        case
          when agreement_state in ('renewal_pending', 'renewal_sent')
            then 'renewal_signature_request'
          else 'signature_request'
        end,
        'pending',
        now()
      where not exists (
        select 1
        from public.agreement_notifications
        where agreement_notifications.agreement_id = v_agreement_id
          and agreement_notifications.status = 'pending'
      );

      if agreement_state in ('renewal_pending', 'renewal_sent') then
        update public.tenancies
        set
          renewal_status = 'pending_signature',
          updated_at = now()
        where id = tenancy_record.id;
      end if;
    end if;
  end loop;
end;
$backfill$;
