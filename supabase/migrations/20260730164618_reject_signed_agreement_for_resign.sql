alter table public.tenancy_agreements
  add column if not exists admin_rejected_at timestamptz,
  add column if not exists admin_rejected_by uuid
    references auth.users(id) on delete restrict,
  add column if not exists admin_rejection_reason text,
  add column if not exists replacement_agreement_id uuid
    references public.tenancy_agreements(id) on delete restrict;

alter table public.tenancy_agreements
  drop constraint if exists tenancy_agreements_admin_review_state_check;
alter table public.tenancy_agreements
  add constraint tenancy_agreements_admin_review_state_check check (
    not (
      admin_verified_at is not null
      and admin_rejected_at is not null
    )
    and (
      (
        admin_rejected_at is null
        and admin_rejected_by is null
        and admin_rejection_reason is null
      )
      or (
        admin_rejected_at is not null
        and admin_rejected_by is not null
        and nullif(btrim(admin_rejection_reason), '') is not null
        and char_length(admin_rejection_reason) <= 1000
      )
    )
  );

drop index if exists public.tenancy_agreements_unique_term_idx;
create unique index tenancy_agreements_unique_active_term_idx
  on public.tenancy_agreements (
    tenancy_id,
    term_start_date,
    term_end_date
  )
  where term_start_date is not null
    and term_end_date is not null
    and admin_rejected_at is null;

drop index if exists public.tenancy_agreements_pending_admin_verification_idx;
create index tenancy_agreements_pending_admin_verification_idx
  on public.tenancy_agreements (signed_at desc)
  where signed_at is not null
    and admin_verified_at is null
    and admin_rejected_at is null;

create index if not exists tenancy_agreements_replacement_idx
  on public.tenancy_agreements (replacement_agreement_id)
  where replacement_agreement_id is not null;

alter table public.tenancy_agreement_verification_logs
  add column if not exists reason text,
  add column if not exists replacement_agreement_id uuid
    references public.tenancy_agreements(id) on delete restrict;

alter table public.tenancy_agreement_verification_logs
  drop constraint if exists tenancy_agreement_verification_logs_action_check;
alter table public.tenancy_agreement_verification_logs
  add constraint tenancy_agreement_verification_logs_action_check check (
    action in ('verified', 'rejected_for_resign')
  );

create or replace function public.reject_signed_agreement_and_request_resign(
  source_agreement_id uuid,
  rejection_reason text,
  replacement_rendered_content text,
  performed_by_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_agreement public.tenancy_agreements%rowtype;
  replacement_id uuid;
  next_version integer;
  rejected_at timestamptz := now();
begin
  if source_agreement_id is null
    or performed_by_user_id is null
    or nullif(btrim(rejection_reason), '') is null
    or char_length(rejection_reason) > 1000
    or nullif(btrim(replacement_rendered_content), '') is null
    or position(
      '[Pending tenant signature]'
      in replacement_rendered_content
    ) = 0
  then
    raise exception 'invalid_signed_agreement_rejection';
  end if;

  select agreements.*
  into source_agreement
  from public.tenancy_agreements as agreements
  where agreements.id = source_agreement_id
    and agreements.status::text in ('signed', 'renewal_signed')
    and agreements.signed_at is not null
    and agreements.admin_verified_at is null
    and agreements.admin_rejected_at is null
  for update;

  if not found then
    raise exception 'signed_agreement_not_pending_review';
  end if;

  select coalesce(max(agreements.version_number), 0) + 1
  into next_version
  from public.tenancy_agreements as agreements
  where agreements.tenancy_id = source_agreement.tenancy_id;

  update public.tenancy_agreements
  set
    admin_rejected_at = rejected_at,
    admin_rejected_by = performed_by_user_id,
    admin_rejection_reason = btrim(rejection_reason),
    updated_at = rejected_at
  where id = source_agreement.id;

  insert into public.tenancy_agreements (
    tenancy_id,
    template_id,
    term_type,
    agreement_type,
    version_number,
    status,
    rendered_content,
    generated_at,
    previous_agreement_id,
    created_by,
    term_start_date,
    term_end_date,
    tenant_name_snapshot,
    property_name_snapshot,
    room_name_snapshot,
    monthly_rent_snapshot
  )
  values (
    source_agreement.tenancy_id,
    source_agreement.template_id,
    source_agreement.term_type,
    source_agreement.agreement_type,
    next_version,
    case
      when source_agreement.term_type::text = 'renewal'
        then 'renewal_pending'::public.agreement_status
      else 'pending_signature'::public.agreement_status
    end,
    replacement_rendered_content,
    rejected_at,
    source_agreement.id,
    performed_by_user_id,
    source_agreement.term_start_date,
    source_agreement.term_end_date,
    source_agreement.tenant_name_snapshot,
    source_agreement.property_name_snapshot,
    source_agreement.room_name_snapshot,
    source_agreement.monthly_rent_snapshot
  )
  returning id into replacement_id;

  update public.tenancy_agreements
  set replacement_agreement_id = replacement_id
  where id = source_agreement.id;

  insert into public.tenancy_agreement_verification_logs (
    agreement_id,
    action,
    performed_by,
    performed_at,
    reason,
    replacement_agreement_id
  )
  values (
    source_agreement.id,
    'rejected_for_resign',
    performed_by_user_id,
    rejected_at,
    btrim(rejection_reason),
    replacement_id
  );

  if source_agreement.term_type::text = 'renewal' then
    update public.tenancy_renewals
    set
      new_agreement_id = replacement_id,
      renewal_status = 'pending_signature',
      updated_at = rejected_at
    where new_agreement_id = source_agreement.id;

    update public.tenancies
    set
      renewal_status = 'pending_signature',
      updated_at = rejected_at
    where id = source_agreement.tenancy_id;
  end if;

  return replacement_id;
end;
$$;

revoke all on function public.reject_signed_agreement_and_request_resign(
  uuid,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.reject_signed_agreement_and_request_resign(
  uuid,
  text,
  text,
  uuid
) to service_role;

comment on column public.tenancy_agreements.admin_rejected_at is
  'Admin rejection timestamp for a signed copy that must be signed again.';
comment on column public.tenancy_agreements.admin_rejection_reason is
  'Required audit reason for rejecting a signed copy.';
comment on column public.tenancy_agreements.replacement_agreement_id is
  'Unsigned replacement generated after this signed copy was rejected.';
comment on function public.reject_signed_agreement_and_request_resign(
  uuid,
  text,
  text,
  uuid
) is
  'Atomically rejects a signed copy, retains it for audit, and creates one linked unsigned replacement.';
