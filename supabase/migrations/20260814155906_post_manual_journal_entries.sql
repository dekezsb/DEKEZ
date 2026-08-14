create or replace function public.post_manual_journal_entry(
  target_company_id uuid,
  target_entry_date date,
  target_reference_number text,
  target_description text,
  target_lines jsonb,
  target_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_id uuid := gen_random_uuid();
  entry_number_value text;
  debit_total numeric(14, 2);
  credit_total numeric(14, 2);
  line_count integer;
  invalid_line_count integer;
begin
  if target_company_id is null
    or target_entry_date is null
    or nullif(btrim(target_description), '') is null
    or target_created_by is null
    or jsonb_typeof(target_lines) <> 'array'
  then
    raise exception 'journal_details_required';
  end if;

  if not exists (
    select 1
    from public.profiles profiles
    where profiles.id = target_created_by
      and profiles.role::text in ('super_admin', 'admin')
  ) and not exists (
    select 1
    from public.company_users company_users
    where company_users.company_id = target_company_id
      and coalesce(company_users.user_id, company_users.profile_id) = target_created_by
      and company_users.status::text = 'active'
      and company_users.role::text in ('owner', 'admin', 'admin_team')
  ) then
    raise exception 'journal_not_allowed';
  end if;

  if exists (
    select 1
    from public.accounting_periods periods
    where periods.company_id = target_company_id
      and periods.status = 'locked'
      and target_entry_date between periods.period_start and periods.period_end
  ) then
    raise exception 'journal_period_locked';
  end if;

  select count(*)::integer,
    coalesce(sum(coalesce((line ->> 'debit')::numeric, 0)), 0),
    coalesce(sum(coalesce((line ->> 'credit')::numeric, 0)), 0)
  into line_count, debit_total, credit_total
  from jsonb_array_elements(target_lines) line;

  if line_count < 2 or line_count > 100 then
    raise exception 'journal_line_count';
  end if;

  select count(*)::integer
  into invalid_line_count
  from jsonb_array_elements(target_lines) line
  left join public.accounting_accounts accounts
    on accounts.id = nullif(line ->> 'account_id', '')::uuid
    and accounts.company_id = target_company_id
    and accounts.is_active
  left join public.properties properties
    on properties.id = nullif(line ->> 'property_id', '')::uuid
    and properties.company_id = target_company_id
  where accounts.id is null
    or (nullif(line ->> 'property_id', '') is not null and properties.id is null)
    or coalesce((line ->> 'debit')::numeric, 0) < 0
    or coalesce((line ->> 'credit')::numeric, 0) < 0
    or not (
      (coalesce((line ->> 'debit')::numeric, 0) > 0 and coalesce((line ->> 'credit')::numeric, 0) = 0)
      or (coalesce((line ->> 'credit')::numeric, 0) > 0 and coalesce((line ->> 'debit')::numeric, 0) = 0)
    );

  if invalid_line_count > 0 then
    raise exception 'journal_invalid_line';
  end if;
  if debit_total <= 0 or abs(debit_total - credit_total) > 0.005 then
    raise exception 'journal_not_balanced';
  end if;

  entry_number_value := 'JE-' || to_char(target_entry_date, 'YYYYMMDD') || '-' || upper(substr(entry_id::text, 1, 8));
  insert into public.accounting_journal_entries (
    id, company_id, entry_date, entry_number, source_type, reference_number,
    description, status, posted_at, created_by
  ) values (
    entry_id, target_company_id, target_entry_date, entry_number_value,
    'manual_journal', nullif(btrim(target_reference_number), ''),
    btrim(target_description), 'posted', now(), target_created_by
  );

  insert into public.accounting_journal_lines (
    journal_entry_id, account_id, property_id, description, debit, credit
  )
  select
    entry_id,
    (line ->> 'account_id')::uuid,
    nullif(line ->> 'property_id', '')::uuid,
    nullif(btrim(line ->> 'description'), ''),
    round(coalesce((line ->> 'debit')::numeric, 0), 2),
    round(coalesce((line ->> 'credit')::numeric, 0), 2)
  from jsonb_array_elements(target_lines) line;

  insert into public.accounting_audit_logs (
    company_id, entity_type, entity_id, action, after_data, reason, performed_by
  ) values (
    target_company_id, 'accounting_journal_entry', entry_id, 'post_manual_journal',
    jsonb_build_object('entry_number', entry_number_value, 'debit', debit_total, 'credit', credit_total, 'lines', target_lines),
    'Balanced manual journal entry posted from DEKEZ Accounting.', target_created_by
  );

  return entry_id;
end;
$$;

revoke all on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) from public;
revoke all on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) from anon;
revoke all on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) from authenticated;
grant execute on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) to service_role;

comment on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) is
  'Atomically posts one balanced manual journal with validated company accounts, optional property dimensions and a permanent audit record.';
