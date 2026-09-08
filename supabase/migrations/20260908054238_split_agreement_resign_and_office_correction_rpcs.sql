-- Keep ordinary signature rejections separate from deliberate commercial-office
-- contract corrections. Both workflows preserve every signed source field and
-- only attach a new, unsigned child agreement.

create or replace function public.validate_tenancy_agreement_correction_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous_agreement public.tenancy_agreements%rowtype;
  replacement_agreement public.tenancy_agreements%rowtype;
begin
  if new.is_correction then
    select agreements.*
    into previous_agreement
    from public.tenancy_agreements as agreements
    where agreements.id = new.previous_agreement_id;

    if not found
      or previous_agreement.tenancy_id is distinct from new.tenancy_id
      or previous_agreement.term_start_date is distinct from new.term_start_date
      or previous_agreement.term_end_date is distinct from new.term_end_date
      or previous_agreement.agreement_type is distinct from new.agreement_type
      or previous_agreement.monthly_rent_snapshot is distinct from new.monthly_rent_snapshot
      or previous_agreement.signed_at is null
      or previous_agreement.status::text not in ('signed', 'renewal_signed')
    then
      raise exception 'invalid_tenancy_agreement_correction_lineage';
    end if;
  end if;

  if new.replacement_agreement_id is not null then
    select agreements.*
    into replacement_agreement
    from public.tenancy_agreements as agreements
    where agreements.id = new.replacement_agreement_id;

    if not found
      or replacement_agreement.previous_agreement_id is distinct from new.id
      or replacement_agreement.tenancy_id is distinct from new.tenancy_id
      or replacement_agreement.term_start_date is distinct from new.term_start_date
      or replacement_agreement.term_end_date is distinct from new.term_end_date
    then
      raise exception 'invalid_tenancy_agreement_replacement_link';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_tenancy_agreement_correction_lineage
  on public.tenancy_agreements;
create trigger validate_tenancy_agreement_correction_lineage
before insert or update of
  is_correction,
  previous_agreement_id,
  replacement_agreement_id,
  tenancy_id,
  term_start_date,
  term_end_date,
  agreement_type,
  monthly_rent_snapshot
on public.tenancy_agreements
for each row
execute function public.validate_tenancy_agreement_correction_lineage();

revoke all on function public.validate_tenancy_agreement_correction_lineage()
  from public, anon, authenticated;

-- Backward-compatible five-argument signature-rejection RPC. The rendered
-- content and template arguments are retained for deployed callers, but are
-- intentionally ignored: a routine signature retry must preserve the source
-- agreement wording and template exactly.
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
  source_tenancy_id uuid;
  replacement_id uuid;
  next_version integer;
  rejected_at timestamptz := now();
  preserved_content text;
begin
  if source_agreement_id is null
    or performed_by_user_id is null
    or nullif(btrim(rejection_reason), '') is null
    or char_length(rejection_reason) > 1000
  then
    raise exception 'invalid_signed_agreement_rejection';
  end if;

  select agreements.tenancy_id
  into source_tenancy_id
  from public.tenancy_agreements as agreements
  where agreements.id = source_agreement_id;

  if not found then
    raise exception 'signed_agreement_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(source_tenancy_id::text, 0)
  );

  select agreements.*
  into source_agreement
  from public.tenancy_agreements as agreements
  where agreements.id = source_agreement_id
  for update;

  if source_agreement.replacement_agreement_id is not null then
    select replacements.id
    into replacement_id
    from public.tenancy_agreements as replacements
    where replacements.id = source_agreement.replacement_agreement_id
      and replacements.previous_agreement_id = source_agreement.id
      and replacements.tenancy_id = source_agreement.tenancy_id;

    if replacement_id is null then
      raise exception 'invalid_tenancy_agreement_replacement_link';
    end if;

    return replacement_id;
  end if;

  if source_agreement.status::text not in ('signed', 'renewal_signed')
    or source_agreement.signed_at is null
    or source_agreement.admin_verified_at is not null
    or source_agreement.admin_rejected_at is not null
  then
    raise exception 'signed_agreement_not_pending_review';
  end if;

  preserved_content := pg_catalog.regexp_replace(
    source_agreement.rendered_content,
    'Signed digitally by [^\r\n]+',
    '[Pending tenant signature]'
  );

  if preserved_content = source_agreement.rendered_content
    or position('[Pending tenant signature]' in preserved_content) = 0
  then
    raise exception 'signed_agreement_signature_marker_not_found';
  end if;

  select coalesce(max(agreements.version_number), 0) + 1
  into next_version
  from public.tenancy_agreements as agreements
  where agreements.tenancy_id = source_agreement.tenancy_id;

  -- Exclude the signed source from the leaf-term index before inserting its
  -- same-classification replacement. This also permits signature retries of a
  -- corrected agreement without creating a second simultaneous correction.
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
    monthly_rent_snapshot,
    is_correction,
    correction_reason
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
    preserved_content,
    rejected_at,
    source_agreement.id,
    performed_by_user_id,
    source_agreement.term_start_date,
    source_agreement.term_end_date,
    source_agreement.tenant_name_snapshot,
    source_agreement.property_name_snapshot,
    source_agreement.room_name_snapshot,
    source_agreement.monthly_rent_snapshot,
    source_agreement.is_correction,
    case
      when source_agreement.is_correction
        then source_agreement.correction_reason
      else null
    end
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

comment on function public.reject_signed_agreement_and_request_resign(
  uuid,
  text,
  text,
  uuid,
  uuid
) is
  'Backward-compatible signature-rejection RPC. It ignores caller-supplied wording/template data and creates an exact content-preserving unsigned retry.';

-- The four-argument overload remains the preferred generic signature-retry
-- entry point for application code.
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
begin
  return public.reject_signed_agreement_and_request_resign(
    source_agreement_id,
    rejection_reason,
    replacement_rendered_content,
    null::uuid,
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
  'Creates an auditable, content-preserving signature retry for a signed agreement that is still pending admin review.';

create or replace function public.issue_corrected_commercial_agreement(
  source_agreement_id uuid,
  correction_reason text,
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
  source_tenancy_id uuid;
  replacement_id uuid;
  next_version integer;
  issued_at timestamptz := now();
  malaysia_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  security_deposit numeric(12, 2);
  utility_deposit numeric(12, 2);
  normalized_content text;
  corrected_content text;
  review_action text;
begin
  if source_agreement_id is null
    or performed_by_user_id is null
    or replacement_template_id is null
    or nullif(btrim(correction_reason), '') is null
    or char_length(correction_reason) > 1000
    or nullif(btrim(replacement_rendered_content), '') is null
    or position(
      '[Pending tenant signature]'
      in replacement_rendered_content
    ) = 0
  then
    raise exception 'invalid_commercial_agreement_correction';
  end if;

  select agreements.tenancy_id
  into source_tenancy_id
  from public.tenancy_agreements as agreements
  where agreements.id = source_agreement_id;

  if not found then
    raise exception 'signed_agreement_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(source_tenancy_id::text, 0)
  );

  select agreements.*
  into source_agreement
  from public.tenancy_agreements as agreements
  where agreements.id = source_agreement_id
  for update;

  if source_agreement.replacement_agreement_id is not null then
    select replacements.id
    into replacement_id
    from public.tenancy_agreements as replacements
    where replacements.id = source_agreement.replacement_agreement_id
      and replacements.previous_agreement_id = source_agreement.id
      and replacements.tenancy_id = source_agreement.tenancy_id
      and replacements.is_correction = true;

    if replacement_id is null then
      raise exception 'signed_agreement_already_has_non_correction_replacement';
    end if;

    return replacement_id;
  end if;

  if source_agreement.status::text not in ('signed', 'renewal_signed')
    or source_agreement.signed_at is null
    or source_agreement.admin_rejected_at is not null
    or source_agreement.is_correction
    or source_agreement.agreement_type::text <> 'commercial_office'
    or source_agreement.term_start_date is null
    or source_agreement.term_end_date is null
    or source_agreement.term_start_date > malaysia_today
    or source_agreement.term_end_date < malaysia_today
    or coalesce(source_agreement.monthly_rent_snapshot, 0) <= 0
  then
    raise exception 'signed_commercial_agreement_not_available_for_correction';
  end if;

  if not exists (
    select 1
    from public.tenancies as tenancies
    join public.properties as properties
      on properties.id = tenancies.property_id
    where tenancies.id = source_agreement.tenancy_id
      and tenancies.status = 'active'
      and tenancies.checkout_date is null
      and coalesce(tenancies.billing_status, 'active') not in ('terminated', 'completed')
      and properties.is_commercial = true
  ) then
    raise exception 'commercial_tenancy_not_active';
  end if;

  if not exists (
    select 1
    from public.tenancy_agreement_templates as templates
    where templates.id = replacement_template_id
      and templates.property_id is null
      and templates.name = 'DEKEZ Master Tenancy Agreement'
      and templates.is_active = true
  ) then
    raise exception 'invalid_replacement_agreement_template';
  end if;

  security_deposit := round(source_agreement.monthly_rent_snapshot * 2, 2);
  utility_deposit := round(source_agreement.monthly_rent_snapshot * 0.5, 2);
  normalized_content := pg_catalog.regexp_replace(
    pg_catalog.replace(replacement_rendered_content, ',', ''),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if position(
      'Security Deposit: RM '
      || pg_catalog.to_char(security_deposit, 'FM999999990.00')
      in normalized_content
    ) = 0
    or position(
      'Utility Deposit: RM '
      || pg_catalog.to_char(utility_deposit, 'FM999999990.00')
      in normalized_content
    ) = 0
    or position('two (2) months of Monthly Rent' in normalized_content) = 0
    or position('one-half (0.5) month of Monthly Rent' in normalized_content) = 0
  then
    raise exception 'commercial_deposit_schedule_not_exact';
  end if;

  corrected_content := pg_catalog.format(
    E'# CORRECTED AND RESTATED TENANCY AGREEMENT\n\nCorrection Notice: This corrected and restated version was issued to correct the commercial-office deposit schedule for signed agreement %s (version %s). The original signed PDF remains preserved for audit. Once this version is signed, it is the operative agreement for the same tenancy term.\n\nCorrection Reason: %s\n\n***\n\n%s',
    source_agreement.id,
    source_agreement.version_number,
    btrim(correction_reason),
    replacement_rendered_content
  );

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
    corrected_content,
    issued_at,
    source_agreement.id,
    performed_by_user_id,
    source_agreement.term_start_date,
    source_agreement.term_end_date,
    source_agreement.tenant_name_snapshot,
    source_agreement.property_name_snapshot,
    source_agreement.room_name_snapshot,
    source_agreement.monthly_rent_snapshot,
    true,
    btrim(correction_reason)
  )
  returning id into replacement_id;

  if source_agreement.admin_verified_at is null then
    update public.tenancy_agreements
    set
      admin_rejected_at = issued_at,
      admin_rejected_by = performed_by_user_id,
      admin_rejection_reason = btrim(correction_reason),
      replacement_agreement_id = replacement_id,
      updated_at = issued_at
    where id = source_agreement.id;
    review_action := 'rejected_for_resign';
  else
    update public.tenancy_agreements
    set
      replacement_agreement_id = replacement_id,
      updated_at = issued_at
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
    issued_at,
    btrim(correction_reason),
    replacement_id
  );

  if source_agreement.term_type::text = 'renewal' then
    update public.tenancy_renewals
    set
      new_agreement_id = replacement_id,
      renewal_status = 'pending_signature',
      updated_at = issued_at
    where new_agreement_id = source_agreement.id;

    update public.tenancies
    set
      renewal_status = 'pending_signature',
      updated_at = issued_at
    where id = source_agreement.tenancy_id;
  end if;

  return replacement_id;
end;
$$;

revoke all on function public.issue_corrected_commercial_agreement(
  uuid,
  text,
  text,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.issue_corrected_commercial_agreement(
  uuid,
  text,
  text,
  uuid,
  uuid
) to service_role;

comment on function public.issue_corrected_commercial_agreement(
  uuid,
  text,
  text,
  uuid,
  uuid
) is
  'Idempotently issues one auditable corrected and restated commercial-office agreement for the active term while preserving the signed source content and PDF.';
