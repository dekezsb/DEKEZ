-- A later statement whose period fully covers an earlier one (e.g. a full
-- September export after a mid-month export) becomes that month's statement.
-- The earlier statement is linked, never deleted or voided: its file, lines,
-- balances, matches and audit history stay exactly as they are. Grouping is
-- display-only; transaction reuse already happens per line on import.
alter table public.bank_statement_imports add column merged_into_statement_id uuid
  references public.bank_statement_imports(id) on delete set null;
alter table public.bank_statement_imports add constraint bank_statement_imports_not_merged_into_self
  check (merged_into_statement_id is distinct from id);
create index bank_statement_imports_merged_into_idx on public.bank_statement_imports(merged_into_statement_id)
  where merged_into_statement_id is not null;

create function public.link_contained_bank_statements(p_statement_id uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare s public.bank_statement_imports%rowtype; linked integer;
begin
  select * into s from public.bank_statement_imports where id=p_statement_id;
  -- Only a root statement can absorb others, so a chain can never loop.
  if s.id is null or s.status='void' or s.merged_into_statement_id is not null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(s.bank_account_id::text,1810));
  with linked_rows as (
    update public.bank_statement_imports old set merged_into_statement_id=s.id
    where old.id<>s.id and old.company_id=s.company_id and old.bank_account_id=s.bank_account_id
      and old.status<>'void' and old.merged_into_statement_id is null
      and old.period_start>=s.period_start and old.period_end<=s.period_end
    returning old.id,old.period_start,old.period_end
  ), logged as (
    insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,reason,performed_by)
    select s.company_id,'bank_statement_import',l.id,'merge_into_covering_statement',
      jsonb_build_object('merged_into_statement_id',s.id,'period_start',l.period_start,'period_end',l.period_end),
      'Covered by a later statement for the same account; original statement retained',s.created_by
    from linked_rows l returning 1
  ) select count(*) into linked from logged;
  return linked;
end $$;
revoke all on function public.link_contained_bank_statements(uuid) from public,anon,authenticated;
grant execute on function public.link_contained_bank_statements(uuid) to service_role;
