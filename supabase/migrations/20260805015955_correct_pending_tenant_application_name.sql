create or replace function public.correct_pending_tenant_application_name(
  p_application_id uuid,
  p_actor_id uuid,
  p_full_name text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_application public.tenant_applications%rowtype;
  v_company_id uuid;
  v_corrected_name text;
  v_profile_updated boolean := false;
begin
  v_corrected_name := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');

  if p_application_id is null
    or p_actor_id is null
    or char_length(v_corrected_name) < 2
    or char_length(v_corrected_name) > 150
    or nullif(btrim(p_reason), '') is null
  then
    raise exception 'identity_correction_details_required';
  end if;

  perform 1
  from public.profiles
  where id = p_actor_id
    and role = 'super_admin';

  if not found then
    raise exception 'identity_correction_not_authorized';
  end if;

  select applications.*
  into v_application
  from public.tenant_applications applications
  where applications.id = p_application_id
  for update;

  if not found
    or v_application.verification_status <> 'pending_verification'
    or v_application.status not in ('submitted', 'pending_verification')
  then
    raise exception 'identity_correction_application_changed';
  end if;

  if lower(v_corrected_name) = lower(v_application.full_name) then
    raise exception 'identity_correction_name_unchanged';
  end if;

  if v_application.ic_passport_number is not null
    and lower(v_corrected_name) = lower(btrim(v_application.ic_passport_number))
  then
    raise exception 'identity_correction_name_matches_identity';
  end if;

  select properties.company_id
  into v_company_id
  from public.properties properties
  where properties.id = v_application.property_id;

  update public.tenant_applications
  set full_name = v_corrected_name,
      updated_at = now()
  where id = v_application.id;

  if v_application.tenant_id is not null
    and v_application.submission_source = 'self_registration'
  then
    update public.profiles
    set full_name = v_corrected_name,
        updated_at = now()
    where id = v_application.tenant_id
      and registration_status = 'pending_verification';

    v_profile_updated := found;
  end if;

  insert into public.audit_logs (
    company_id,
    actor_profile_id,
    action,
    entity_table,
    entity_id,
    metadata
  )
  values (
    v_company_id,
    p_actor_id,
    'pending_tenant_application_name_corrected',
    'tenant_applications',
    v_application.id,
    jsonb_build_object(
      'previous_full_name', v_application.full_name,
      'corrected_full_name', v_corrected_name,
      'correction_reason', btrim(p_reason),
      'submission_source', v_application.submission_source,
      'linked_profile_updated', v_profile_updated,
      'identity_number_unchanged', true
    )
  );

  return jsonb_build_object(
    'application_id', v_application.id,
    'tenant_id', v_application.tenant_id,
    'previous_full_name', v_application.full_name,
    'corrected_full_name', v_corrected_name,
    'linked_profile_updated', v_profile_updated
  );
end;
$$;

revoke all on function public.correct_pending_tenant_application_name(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.correct_pending_tenant_application_name(
  uuid,
  uuid,
  text,
  text
) to service_role;

comment on function public.correct_pending_tenant_application_name(
  uuid,
  uuid,
  text,
  text
) is
  'Atomically corrects a pending applicant name, its pending self-registration profile, and the audit trail without changing the IC or passport number.';
