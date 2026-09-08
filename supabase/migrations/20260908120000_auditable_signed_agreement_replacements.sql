alter table public.tenancy_agreements
  add column if not exists is_correction boolean not null default false,
  add column if not exists correction_reason text;

alter table public.tenancy_agreements
  drop constraint if exists tenancy_agreements_correction_state_check;
alter table public.tenancy_agreements
  add constraint tenancy_agreements_correction_state_check check (
    (
      is_correction = false
      and correction_reason is null
    )
    or (
      is_correction = true
      and previous_agreement_id is not null
      and nullif(btrim(correction_reason), '') is not null
      and char_length(correction_reason) <= 1000
    )
  );

drop index if exists public.tenancy_agreements_unique_active_term_idx;

create unique index tenancy_agreements_unique_current_term_idx
  on public.tenancy_agreements (
    tenancy_id,
    term_start_date,
    term_end_date
  )
  where term_start_date is not null
    and term_end_date is not null
    and admin_rejected_at is null
    and replacement_agreement_id is null
    and is_correction = false;

create unique index tenancy_agreements_unique_correction_term_idx
  on public.tenancy_agreements (
    tenancy_id,
    term_start_date,
    term_end_date
  )
  where term_start_date is not null
    and term_end_date is not null
    and admin_rejected_at is null
    and replacement_agreement_id is null
    and is_correction = true;

alter table public.tenancy_agreement_verification_logs
  drop constraint if exists tenancy_agreement_verification_logs_action_check;
alter table public.tenancy_agreement_verification_logs
  add constraint tenancy_agreement_verification_logs_action_check check (
    action in ('verified', 'rejected_for_resign', 'superseded_for_resign')
  );

create or replace function public.reject_signed_agreement_and_request_resign(
  source_agreement_id uuid,
  rejection_reason text,
  replacement_rendered_content text,
  replacement_template_id uuid,
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
  review_action text;
begin
  if source_agreement_id is null
    or performed_by_user_id is null
    or replacement_template_id is null
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
    and agreements.status in (
      'signed'::public.agreement_status,
      'renewal_signed'::public.agreement_status
    )
    and agreements.signed_at is not null
    and agreements.admin_rejected_at is null
    and agreements.replacement_agreement_id is null
  for update;

  if not found then
    raise exception 'signed_agreement_not_available_for_replacement';
  end if;

  if not exists (
    select 1
    from public.tenancy_agreement_templates as templates
    where templates.id = replacement_template_id
      and templates.property_id is null
      and templates.name = 'DEKEZ Master Tenancy Agreement'
  ) then
    raise exception 'invalid_replacement_agreement_template';
  end if;

  select coalesce(max(agreements.version_number), 0) + 1
  into next_version
  from public.tenancy_agreements as agreements
  where agreements.tenancy_id = source_agreement.tenancy_id;

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
    monthly_rent_snapshot,
    is_correction,
    correction_reason
  )
  values (
    source_agreement.tenancy_id,
    replacement_template_id,
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
    source_agreement.monthly_rent_snapshot,
    true,
    btrim(rejection_reason)
  )
  returning id into replacement_id;

  if source_agreement.admin_verified_at is null then
    update public.tenancy_agreements
    set
      admin_rejected_at = rejected_at,
      admin_rejected_by = performed_by_user_id,
      admin_rejection_reason = btrim(rejection_reason),
      replacement_agreement_id = replacement_id,
      updated_at = rejected_at
    where id = source_agreement.id;
    review_action := 'rejected_for_resign';
  else
    update public.tenancy_agreements
    set
      replacement_agreement_id = replacement_id,
      updated_at = rejected_at
    where id = source_agreement.id;
    review_action := 'superseded_for_resign';
  end if;

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
    review_action,
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
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.reject_signed_agreement_and_request_resign(
  uuid,
  text,
  text,
  uuid,
  uuid
) to service_role;

comment on column public.tenancy_agreements.replacement_agreement_id is
  'Linked corrected copy for re-signing; the original signed record remains immutable for audit.';

comment on function public.reject_signed_agreement_and_request_resign(
  uuid,
  text,
  text,
  uuid,
  uuid
) is
  'Preserves a signed agreement and creates one linked, auditable replacement for tenant re-signing.';

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
  active_template_id uuid;
begin
  select templates.id
  into active_template_id
  from public.tenancy_agreement_templates as templates
  where templates.property_id is null
    and templates.name = 'DEKEZ Master Tenancy Agreement'
    and templates.is_active = true
  order by templates.version desc, templates.updated_at desc
  limit 1;

  if active_template_id is null then
    raise exception 'replacement_agreement_template_not_found';
  end if;

  return public.reject_signed_agreement_and_request_resign(
    source_agreement_id,
    rejection_reason,
    replacement_rendered_content,
    active_template_id,
    performed_by_user_id
  );
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

comment on function public.reject_signed_agreement_and_request_resign(
  uuid,
  text,
  text,
  uuid
) is
  'Backward-compatible wrapper that uses the active master template for a signed-agreement replacement.';
