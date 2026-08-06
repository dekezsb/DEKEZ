create schema if not exists private;

create table if not exists public.referral_promotions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  promotion_name text not null,
  reward_amount numeric(12,2) not null check (reward_amount > 0),
  minimum_contract_months integer not null check (minimum_contract_months >= 1),
  start_date date not null,
  end_date date not null,
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_promotions_dates_check check (end_date >= start_date),
  constraint referral_promotions_campaign_key unique (company_id, promotion_name, start_date, end_date)
);

create table if not exists public.tenant_referral_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  referral_code text not null,
  created_at timestamptz not null default now(),
  constraint tenant_referral_codes_tenant_key unique (tenant_id),
  constraint tenant_referral_codes_code_key unique (referral_code)
);

create table if not exists public.tenant_referrals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  promotion_id uuid not null references public.referral_promotions(id) on delete restrict,
  referrer_tenant_id uuid not null references public.tenants(id) on delete restrict,
  referred_application_id uuid not null references public.tenant_applications(id) on delete cascade,
  referred_tenant_id uuid references public.tenants(id) on delete restrict,
  tenancy_id uuid references public.tenancies(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  referral_input text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','reward_applied')),
  reward_amount numeric(12,2) not null check (reward_amount > 0),
  rejection_reason text,
  registration_date timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  applied_invoice_id uuid references public.rent_bills(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_referrals_application_key unique (referred_application_id)
);

create table if not exists public.rental_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  referral_id uuid not null references public.tenant_referrals(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  original_amount numeric(12,2) not null check (original_amount > 0),
  remaining_amount numeric(12,2) not null check (remaining_amount >= 0),
  eligible_bill_month date not null,
  status text not null default 'available' check (status in ('available','partially_applied','applied','voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_credits_referral_key unique (referral_id),
  constraint rental_credits_balance_check check (remaining_amount <= original_amount)
);

create table if not exists public.rental_credit_applications (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.rental_credits(id) on delete restrict,
  rent_bill_id uuid not null references public.rent_bills(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  applied_at timestamptz not null default now(),
  applied_by uuid references auth.users(id) on delete set null,
  constraint rental_credit_applications_credit_bill_key unique (credit_id, rent_bill_id)
);

create table if not exists public.referral_audit_logs (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.tenant_referrals(id) on delete restrict,
  action text not null,
  status text not null,
  reward_amount numeric(12,2),
  invoice_applied_id uuid references public.rent_bills(id) on delete set null,
  applied_by uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.rent_bills
  add column if not exists gross_rent_amount numeric(12,2) not null default 0,
  add column if not exists referral_credit_amount numeric(12,2) not null default 0;

update public.rent_bills
set gross_rent_amount = amount
where gross_rent_amount = 0 and amount > 0;

alter table public.rent_bills drop constraint if exists rent_bills_referral_credit_check;
alter table public.rent_bills add constraint rent_bills_referral_credit_check
  check (
    gross_rent_amount >= 0
    and referral_credit_amount >= 0
    and referral_credit_amount <= gross_rent_amount
    and amount >= 0
  ) not valid;

create index if not exists referral_promotions_company_dates_idx
  on public.referral_promotions (company_id, enabled, start_date, end_date);
create index if not exists tenant_referral_codes_company_idx
  on public.tenant_referral_codes (company_id, referral_code);
create index if not exists tenant_referrals_referrer_status_idx
  on public.tenant_referrals (referrer_tenant_id, status, registration_date desc);
create index if not exists tenant_referrals_promotion_status_idx
  on public.tenant_referrals (promotion_id, status, registration_date desc);
create index if not exists tenant_referrals_referred_tenant_idx
  on public.tenant_referrals (referred_tenant_id) where referred_tenant_id is not null;
create index if not exists tenant_referrals_tenancy_idx
  on public.tenant_referrals (tenancy_id) where tenancy_id is not null;
create index if not exists rental_credits_tenant_available_idx
  on public.rental_credits (tenant_id, eligible_bill_month, created_at)
  where status in ('available','partially_applied');
create index if not exists rental_credit_applications_bill_idx
  on public.rental_credit_applications (rent_bill_id);
create index if not exists referral_audit_logs_referral_created_idx
  on public.referral_audit_logs (referral_id, created_at desc);

insert into public.referral_promotions (
  company_id,
  promotion_name,
  reward_amount,
  minimum_contract_months,
  start_date,
  end_date,
  enabled
)
select
  company.id,
  'Invite a Friend & Earn RM50',
  50,
  6,
  date '2026-08-01',
  date '2026-08-31',
  true
from public.companies company
where company.status::text = 'active'
on conflict (company_id, promotion_name, start_date, end_date) do update
set reward_amount = excluded.reward_amount,
    minimum_contract_months = excluded.minimum_contract_months,
    updated_at = now();

insert into public.tenant_referral_codes (company_id, tenant_id, referral_code)
select
  tenant.company_id,
  tenant.id,
  'DEKEZ-' || upper(substr(replace(tenant.id::text, '-', ''), 1, 8))
from public.tenants tenant
where tenant.profile_id is not null
on conflict (tenant_id) do nothing;

create or replace function private.create_tenant_referral_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.profile_id is not null then
    insert into public.tenant_referral_codes (company_id, tenant_id, referral_code)
    values (
      new.company_id,
      new.id,
      'DEKEZ-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))
    )
    on conflict (tenant_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_referral_code_after_insert on public.tenants;
create trigger tenant_referral_code_after_insert
after insert or update of profile_id on public.tenants
for each row execute function private.create_tenant_referral_code();

create or replace function private.reject_tenant_referral(
  p_referral_id uuid,
  p_reason text,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_referral public.tenant_referrals%rowtype;
begin
  update public.tenant_referrals
  set status = 'rejected',
      rejection_reason = left(nullif(btrim(p_reason), ''), 1000),
      updated_at = now()
  where id = p_referral_id and status = 'pending'
  returning * into v_referral;

  if found then
    insert into public.referral_audit_logs (
      referral_id, action, status, reward_amount, applied_by, details
    ) values (
      v_referral.id,
      'rejected',
      'rejected',
      v_referral.reward_amount,
      p_actor_id,
      jsonb_build_object('reason', coalesce(v_referral.rejection_reason, 'Referral rejected'))
    );
  end if;
end;
$$;

create or replace function private.evaluate_referral_application(
  p_application_id uuid,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_referral public.tenant_referrals%rowtype;
  v_application public.tenant_applications%rowtype;
  v_promotion public.referral_promotions%rowtype;
  v_referrer public.tenants%rowtype;
  v_referrer_profile public.profiles%rowtype;
  v_new_profile public.profiles%rowtype;
  v_tenancy public.tenancies%rowtype;
  v_referred_tenant public.tenants%rowtype;
  v_registration_day date;
  v_identity_documents integer := 0;
  v_required_identity_documents integer := 1;
  v_duplicate_identity boolean := false;
  v_same_email boolean := false;
begin
  select * into v_referral
  from public.tenant_referrals
  where referred_application_id = p_application_id
  for update;

  if not found or v_referral.status <> 'pending' then
    return;
  end if;

  select * into v_application
  from public.tenant_applications
  where id = p_application_id;

  if not found then
    perform private.reject_tenant_referral(v_referral.id, 'Registration no longer exists.', p_actor_id);
    return;
  end if;

  select * into v_promotion
  from public.referral_promotions
  where id = v_referral.promotion_id;

  v_registration_day := (v_referral.registration_date at time zone 'Asia/Kuala_Lumpur')::date;

  if not v_promotion.enabled
     or v_registration_day < v_promotion.start_date
     or v_registration_day > v_promotion.end_date then
    perform private.reject_tenant_referral(v_referral.id, 'Registration is outside the promotion period.', p_actor_id);
    return;
  end if;

  if v_application.status = 'rejected' then
    perform private.reject_tenant_referral(v_referral.id, 'Registration was rejected or cancelled.', p_actor_id);
    return;
  end if;

  if v_application.submission_source not in ('tenant_portal','self_registration') then
    perform private.reject_tenant_referral(v_referral.id, 'Registration was not submitted through the Tenant Portal.', p_actor_id);
    return;
  end if;

  if v_application.rental_model <> 'tenancy' then
    perform private.reject_tenant_referral(v_referral.id, 'This rental type does not use a six-month tenancy agreement.', p_actor_id);
    return;
  end if;

  if v_application.contract_duration_months < v_promotion.minimum_contract_months then
    perform private.reject_tenant_referral(v_referral.id, 'Contract is shorter than the promotion minimum.', p_actor_id);
    return;
  end if;

  select * into v_referrer from public.tenants where id = v_referral.referrer_tenant_id;
  select * into v_referrer_profile from public.profiles where id = v_referrer.profile_id;
  select * into v_new_profile from public.profiles where id = v_application.tenant_id;

  if v_referrer.profile_id is null or v_referrer.profile_id = v_application.tenant_id then
    perform private.reject_tenant_referral(v_referral.id, 'Self-referral is not allowed.', p_actor_id);
    return;
  end if;

  if regexp_replace(lower(coalesce(v_referrer.phone, v_referrer_profile.phone, '')), '[^a-z0-9]', '', 'g') =
     regexp_replace(lower(coalesce(v_application.whatsapp_number, v_new_profile.phone, '')), '[^a-z0-9]', '', 'g') then
    perform private.reject_tenant_referral(v_referral.id, 'The referrer and new tenant use the same phone number.', p_actor_id);
    return;
  end if;

  if nullif(regexp_replace(lower(coalesce(v_referrer.identity_number, v_referrer_profile.identity_number, '')), '[^a-z0-9]', '', 'g'), '') =
     nullif(regexp_replace(lower(coalesce(v_application.ic_passport_number, v_new_profile.identity_number, '')), '[^a-z0-9]', '', 'g'), '') then
    perform private.reject_tenant_referral(v_referral.id, 'The referrer and new tenant use the same identity number.', p_actor_id);
    return;
  end if;

  v_same_email := nullif(lower(btrim(coalesce(v_referrer.email, v_referrer.business_email, ''))), '') is not null
    and lower(btrim(coalesce(v_referrer.email, v_referrer.business_email, ''))) =
        lower(btrim(coalesce(v_application.business_email, '')));
  if v_same_email then
    perform private.reject_tenant_referral(v_referral.id, 'The referrer and new tenant use the same email.', p_actor_id);
    return;
  end if;

  select exists (
    select 1
    from public.profiles duplicate_profile
    where duplicate_profile.id <> v_application.tenant_id
      and nullif(regexp_replace(lower(coalesce(duplicate_profile.identity_number, '')), '[^a-z0-9]', '', 'g'), '') =
          nullif(regexp_replace(lower(coalesce(v_application.ic_passport_number, '')), '[^a-z0-9]', '', 'g'), '')
  ) into v_duplicate_identity;

  if v_duplicate_identity then
    perform private.reject_tenant_referral(v_referral.id, 'Duplicate registration or identity number detected.', p_actor_id);
    return;
  end if;

  if v_application.status <> 'converted_to_tenancy'
     or v_application.verification_status <> 'verified'
     or v_application.payment_status <> 'verified'
     or v_new_profile.registration_status <> 'approved' then
    return;
  end if;

  v_required_identity_documents := case when v_application.identity_type = 'ic' then 2 else 1 end;
  select count(distinct document.document_type)::integer
  into v_identity_documents
  from public.tenant_documents document
  where document.tenant_application_id = v_application.id
    and document.verification_status = 'verified'
    and document.document_type = any (
      case when v_application.identity_type = 'ic'
        then array['ic_front','ic_back']::text[]
        else array['passport_photo_page']::text[]
      end
    );

  if v_identity_documents < v_required_identity_documents then
    return;
  end if;

  select * into v_tenancy
  from public.tenancies
  where tenant_application_id = v_application.id
  order by created_at desc
  limit 1;

  if not found then
    return;
  end if;

  if v_tenancy.status::text = 'cancelled'
     or v_tenancy.billing_status in ('terminated','completed') then
    perform private.reject_tenant_referral(v_referral.id, 'Check-in or tenancy was cancelled before completion.', p_actor_id);
    return;
  end if;

  if v_tenancy.status::text <> 'active'
     or v_tenancy.billing_status <> 'active'
     or v_tenancy.check_in_date is null
     or v_tenancy.checkout_date is not null
     or v_tenancy.rental_model <> 'tenancy'
     or coalesce(v_tenancy.contract_duration_months, v_application.contract_duration_months) < v_promotion.minimum_contract_months then
    return;
  end if;

  if not exists (
    select 1
    from public.tenancy_agreements agreement
    where agreement.tenancy_id = v_tenancy.id
      and agreement.term_type::text = 'original'
      and agreement.status::text in ('signed','renewal_signed')
      and agreement.signed_at is not null
      and agreement.admin_verified_at is not null
      and agreement.admin_rejected_at is null
  ) then
    return;
  end if;

  select * into v_referred_tenant
  from public.tenants
  where id = v_tenancy.tenant_id;

  update public.tenant_referrals
  set referred_tenant_id = v_referred_tenant.id,
      tenancy_id = v_tenancy.id,
      status = 'approved',
      reward_amount = v_promotion.reward_amount,
      rejection_reason = null,
      approved_at = now(),
      approved_by = p_actor_id,
      updated_at = now()
  where id = v_referral.id and status = 'pending';

  if found then
    insert into public.rental_credits (
      company_id,
      referral_id,
      tenant_id,
      original_amount,
      remaining_amount,
      eligible_bill_month,
      status
    ) values (
      v_referral.company_id,
      v_referral.id,
      v_referral.referrer_tenant_id,
      v_promotion.reward_amount,
      v_promotion.reward_amount,
      (date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 month')::date,
      'available'
    ) on conflict (referral_id) do nothing;

    insert into public.referral_audit_logs (
      referral_id, action, status, reward_amount, applied_by, details
    ) values (
      v_referral.id,
      'approved',
      'approved',
      v_promotion.reward_amount,
      p_actor_id,
      jsonb_build_object(
        'application_id', v_application.id,
        'tenancy_id', v_tenancy.id,
        'minimum_contract_months', v_promotion.minimum_contract_months
      )
    );
  end if;
end;
$$;

create or replace function private.evaluate_referral_from_application()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.evaluate_referral_application(new.id, auth.uid());
  return new;
end;
$$;

create or replace function private.evaluate_referral_from_document()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.tenant_application_id is not null then
    perform private.evaluate_referral_application(new.tenant_application_id, auth.uid());
  end if;
  return new;
end;
$$;

create or replace function private.evaluate_referral_from_tenancy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.tenant_application_id is not null then
    perform private.evaluate_referral_application(new.tenant_application_id, auth.uid());
  end if;
  return new;
end;
$$;

create or replace function private.evaluate_referral_from_agreement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_application_id uuid;
begin
  select tenant_application_id into v_application_id
  from public.tenancies
  where id = new.tenancy_id;
  if v_application_id is not null then
    perform private.evaluate_referral_application(v_application_id, auth.uid());
  end if;
  return new;
end;
$$;

create or replace function private.evaluate_referrals_from_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_application_id uuid;
begin
  for v_application_id in
    select application.id
    from public.tenant_applications application
    join public.tenant_referrals referral on referral.referred_application_id = application.id
    where application.tenant_id = new.id and referral.status = 'pending'
  loop
    perform private.evaluate_referral_application(v_application_id, auth.uid());
  end loop;
  return new;
end;
$$;

drop trigger if exists tenant_referral_application_evaluate on public.tenant_applications;
create trigger tenant_referral_application_evaluate
after update of status, verification_status, payment_status, contract_duration_months on public.tenant_applications
for each row execute function private.evaluate_referral_from_application();

drop trigger if exists tenant_referral_document_evaluate on public.tenant_documents;
create trigger tenant_referral_document_evaluate
after insert or update of verification_status on public.tenant_documents
for each row execute function private.evaluate_referral_from_document();

drop trigger if exists tenant_referral_tenancy_evaluate on public.tenancies;
create trigger tenant_referral_tenancy_evaluate
after insert or update of status, billing_status, check_in_date, checkout_date, contract_duration_months on public.tenancies
for each row execute function private.evaluate_referral_from_tenancy();

drop trigger if exists tenant_referral_agreement_evaluate on public.tenancy_agreements;
create trigger tenant_referral_agreement_evaluate
after insert or update of status, signed_at, admin_verified_at, admin_rejected_at on public.tenancy_agreements
for each row execute function private.evaluate_referral_from_agreement();

drop trigger if exists tenant_referral_profile_evaluate on public.profiles;
create trigger tenant_referral_profile_evaluate
after update of registration_status, identity_number, phone on public.profiles
for each row execute function private.evaluate_referrals_from_profile();

create or replace function private.apply_rental_credits_to_bill()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_credit public.rental_credits%rowtype;
  v_gross numeric(12,2);
  v_capacity numeric(12,2);
  v_applied numeric(12,2);
  v_total_credit numeric(12,2) := 0;
  v_new_remaining numeric(12,2);
begin
  v_gross := coalesce(nullif(new.gross_rent_amount, 0), new.amount, 0);

  if new.tenancy_id is null
     or new.invoice_source <> 'automatic'
     or new.removed_at is not null then
    update public.rent_bills
    set gross_rent_amount = v_gross
    where id = new.id and gross_rent_amount = 0;
    return new;
  end if;

  select * into v_tenancy from public.tenancies where id = new.tenancy_id;
  if not found then
    return new;
  end if;

  v_capacity := greatest(v_gross, 0);

  for v_credit in
    select credit.*
    from public.rental_credits credit
    where credit.tenant_id = v_tenancy.tenant_id
      and credit.status in ('available','partially_applied')
      and credit.remaining_amount > 0
      and credit.eligible_bill_month <= new.bill_month
    order by credit.eligible_bill_month, credit.created_at, credit.id
    for update
  loop
    exit when v_capacity <= 0;
    v_applied := least(v_credit.remaining_amount, v_capacity);
    v_new_remaining := v_credit.remaining_amount - v_applied;

    insert into public.rental_credit_applications (
      credit_id, rent_bill_id, amount, applied_by
    ) values (
      v_credit.id, new.id, v_applied, null
    ) on conflict (credit_id, rent_bill_id) do nothing;

    update public.rental_credits
    set remaining_amount = v_new_remaining,
        status = case when v_new_remaining <= 0 then 'applied' else 'partially_applied' end,
        updated_at = now()
    where id = v_credit.id;

    if v_new_remaining <= 0 then
      update public.tenant_referrals
      set status = 'reward_applied',
          applied_at = now(),
          applied_by = null,
          applied_invoice_id = new.id,
          updated_at = now()
      where id = v_credit.referral_id and status = 'approved';
    end if;

    insert into public.referral_audit_logs (
      referral_id, action, status, reward_amount, invoice_applied_id, applied_by, details
    ) values (
      v_credit.referral_id,
      case when v_new_remaining <= 0 then 'reward_applied' else 'reward_partially_applied' end,
      case when v_new_remaining <= 0 then 'reward_applied' else 'approved' end,
      v_applied,
      new.id,
      null,
      jsonb_build_object('remaining_credit', v_new_remaining, 'bill_month', new.bill_month)
    );

    v_total_credit := v_total_credit + v_applied;
    v_capacity := v_capacity - v_applied;
  end loop;

  update public.rent_bills
  set gross_rent_amount = v_gross,
      referral_credit_amount = v_total_credit,
      amount = greatest(v_gross - v_total_credit, 0),
      updated_at = now()
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists rent_bill_apply_referral_credit on public.rent_bills;
create trigger rent_bill_apply_referral_credit
after insert on public.rent_bills
for each row execute function private.apply_rental_credits_to_bill();

create or replace function public.recheck_tenant_referral(
  p_referral_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_application_id uuid;
begin
  select referred_application_id into v_application_id
  from public.tenant_referrals
  where id = p_referral_id;
  if v_application_id is not null then
    perform private.evaluate_referral_application(v_application_id, p_actor_id);
  end if;
end;
$$;

create or replace function public.reject_tenant_referral(
  p_referral_id uuid,
  p_reason text,
  p_actor_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select private.reject_tenant_referral(p_referral_id, p_reason, p_actor_id);
$$;

alter table public.referral_promotions enable row level security;
alter table public.tenant_referral_codes enable row level security;
alter table public.tenant_referrals enable row level security;
alter table public.rental_credits enable row level security;
alter table public.rental_credit_applications enable row level security;
alter table public.referral_audit_logs enable row level security;

drop policy if exists referral_promotions_select_allowed on public.referral_promotions;
create policy referral_promotions_select_allowed on public.referral_promotions
for select to authenticated using (
  public.is_platform_admin()
  or (enabled and current_date between start_date and end_date)
);

drop policy if exists tenant_referral_codes_select_allowed on public.tenant_referral_codes;
create policy tenant_referral_codes_select_allowed on public.tenant_referral_codes
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenants tenant
    where tenant.id = tenant_id and tenant.profile_id = (select auth.uid())
  )
);

drop policy if exists tenant_referrals_select_allowed on public.tenant_referrals;
create policy tenant_referrals_select_allowed on public.tenant_referrals
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenants tenant
    where tenant.id = referrer_tenant_id and tenant.profile_id = (select auth.uid())
  )
  or exists (
    select 1 from public.tenant_applications application
    where application.id = referred_application_id and application.tenant_id = (select auth.uid())
  )
);

drop policy if exists rental_credits_select_allowed on public.rental_credits;
create policy rental_credits_select_allowed on public.rental_credits
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenants tenant
    where tenant.id = tenant_id and tenant.profile_id = (select auth.uid())
  )
);

drop policy if exists rental_credit_applications_select_allowed on public.rental_credit_applications;
create policy rental_credit_applications_select_allowed on public.rental_credit_applications
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.rental_credits credit
    join public.tenants tenant on tenant.id = credit.tenant_id
    where credit.id = credit_id and tenant.profile_id = (select auth.uid())
  )
);

drop policy if exists referral_audit_logs_select_allowed on public.referral_audit_logs;
create policy referral_audit_logs_select_allowed on public.referral_audit_logs
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenant_referrals referral
    join public.tenants tenant on tenant.id = referral.referrer_tenant_id
    where referral.id = referral_id and tenant.profile_id = (select auth.uid())
  )
);

revoke all on function public.recheck_tenant_referral(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reject_tenant_referral(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.recheck_tenant_referral(uuid, uuid) to service_role;
grant execute on function public.reject_tenant_referral(uuid, text, uuid) to service_role;

grant select on public.referral_promotions to authenticated;
grant select on public.tenant_referral_codes to authenticated;
grant select on public.tenant_referrals to authenticated;
grant select on public.rental_credits to authenticated;
grant select on public.rental_credit_applications to authenticated;
grant select on public.referral_audit_logs to authenticated;

grant all on public.referral_promotions to service_role;
grant all on public.tenant_referral_codes to service_role;
grant all on public.tenant_referrals to service_role;
grant all on public.rental_credits to service_role;
grant all on public.rental_credit_applications to service_role;
grant all on public.referral_audit_logs to service_role;

alter publication supabase_realtime add table public.referral_promotions;
alter publication supabase_realtime add table public.tenant_referrals;
alter publication supabase_realtime add table public.rental_credits;
alter publication supabase_realtime add table public.rental_credit_applications;
