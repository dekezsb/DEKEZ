-- Retain every source statement, but reconcile each real transaction once.
-- Memberships are evidence of an import, NOT a payment or a reconciliation.
lock table public.bank_statement_lines, public.bank_reconciliation_matches in share row exclusive mode;

alter table public.bank_statement_lines add column duplicate_of_line_id uuid
  references public.bank_statement_lines(id) on delete restrict;
create index bank_lines_duplicate_of_idx on public.bank_statement_lines(duplicate_of_line_id)
  where duplicate_of_line_id is not null;

create function public.bank_import_text(p_value text) returns text
language sql immutable parallel safe set search_path='' as $$
  select upper(regexp_replace(trim(coalesce(p_value,'')), '\s+', ' ', 'g'));
$$;

create table public.bank_statement_transaction_members (
  statement_import_id uuid not null references public.bank_statement_imports(id) on delete restrict,
  source_hash text not null,
  statement_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(statement_import_id, source_hash),
  unique(statement_import_id, statement_line_id)
);
create index bank_statement_members_line_idx on public.bank_statement_transaction_members(statement_line_id);
alter table public.bank_statement_transaction_members enable row level security;
revoke all on public.bank_statement_transaction_members from public, anon, authenticated;
grant select on public.bank_statement_transaction_members to authenticated;
grant all on public.bank_statement_transaction_members to service_role;
create policy bank_statement_members_select on public.bank_statement_transaction_members
  for select to authenticated using (exists (
    select 1 from public.bank_statement_imports s where s.id=statement_import_id
    and ((select public.is_platform_admin()) or public.can_manage_company(s.company_id))
  ));

-- Occurrence preserves two genuinely separate, identical-looking lines in ONE
-- source statement. Across files, reuse that same number of occurrences.
create temporary table bank_import_repair on commit drop as
with ranked as (
  select l.*,s.company_id,s.status import_status,s.created_at import_created_at,
    public.bank_import_text(l.reference_number) ref_key,
    public.bank_import_text(l.description) description_key,
    row_number() over(partition by l.statement_import_id,l.bank_account_id,l.transaction_date,l.amount,
      public.bank_import_text(l.reference_number),public.bank_import_text(l.description)
      order by l.created_at,l.id) occurrence,
    (exists(select 1 from public.bank_reconciliation_matches m where m.statement_line_id=l.id)
      or exists(select 1 from public.accounting_payment_reconciliations r where r.bank_transaction_id=l.id)
      or exists(select 1 from public.payments p where p.origin_bank_line_id=l.id)
      or exists(select 1 from public.rental_invoice_line_items i where i.origin_bank_line_id=l.id)
      or exists(select 1 from public.bank_account_transfers t where t.from_statement_line_id=l.id or t.to_statement_line_id=l.id)) has_links
  from public.bank_statement_lines l join public.bank_statement_imports s on s.id=l.statement_import_id
), mapped as (
  select r.*,case when import_status='void' or (ref_key='' and description_key in ('','BANK TRANSACTION')) then id
    else first_value(id) over(partition by bank_account_id,transaction_date,amount,ref_key,description_key,occurrence,import_status='void'
      order by has_links desc,(status in ('matched','adjusted','ignored')) desc,import_created_at,created_at,id)
    end canonical_id from ranked r
)
select * from mapped;

-- Never hide two separately posted records, or rewrite any accounting history.
do $$ begin
  if exists(select 1 from bank_import_repair where id<>canonical_id and has_links) then
    raise exception 'Overlapping bank imports contain independently posted records; no records were changed';
  end if;
end $$;

insert into public.bank_statement_transaction_members(statement_import_id,source_hash,statement_line_id)
select statement_import_id,external_hash,canonical_id from bank_import_repair;
insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason)
select company_id,'bank_statement_line',id,'reuse_existing_bank_transaction',
  jsonb_build_object('status',status,'ignored_reason',ignored_reason),
  jsonb_build_object('duplicate_of_line_id',canonical_id,'status','ignored'),
  'Exact overlapping import: reuse existing transaction and preserve all reconciliation links'
from bank_import_repair where id<>canonical_id;
update public.bank_statement_lines l set duplicate_of_line_id=r.canonical_id,status='ignored',
  ignored_reason='ALREADY IMPORTED: existing bank transaction '||r.canonical_id,updated_at=now()
from bank_import_repair r where l.id=r.id and r.id<>r.canonical_id;

-- Compatibility guard also protects old clients still using INSERT. The whole
-- multi-row insert is atomic, and an account lock serializes overlapping uploads.
create function public.reuse_imported_bank_transaction() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.bank_statement_imports%rowtype; canonical uuid; occurrence integer;
begin
  select * into s from public.bank_statement_imports where id=new.statement_import_id;
  if s.id is null or s.bank_account_id<>new.bank_account_id or s.status<>'in_progress'
    or new.duplicate_of_line_id is not null or new.status<>'unmatched' then
    raise exception 'Invalid statement import';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.bank_account_id::text,1810));
  if exists(select 1 from public.bank_statement_transaction_members
    where statement_import_id=new.statement_import_id and source_hash=new.external_hash)
    or exists(select 1 from public.bank_statement_lines
      where statement_import_id=new.statement_import_id and external_hash=new.external_hash) then
    return null; -- Retry of the same import, including a reused line.
  end if;
  if public.bank_import_text(new.reference_number)<>''
    or public.bank_import_text(new.description) not in ('','BANK TRANSACTION') then
    -- AFTER-row membership triggers can run at statement end, so include new
    -- rows already inserted earlier in this same multi-row INSERT as well.
    select count(*) into occurrence from public.bank_statement_lines l
      where l.duplicate_of_line_id is null and (l.statement_import_id=new.statement_import_id
        or exists(select 1 from public.bank_statement_transaction_members m
          where m.statement_import_id=new.statement_import_id and m.statement_line_id=l.id))
      and l.bank_account_id=new.bank_account_id and l.transaction_date=new.transaction_date and l.amount=new.amount
      and public.bank_import_text(l.reference_number)=public.bank_import_text(new.reference_number)
      and public.bank_import_text(l.description)=public.bank_import_text(new.description);
    select l.id into canonical from public.bank_statement_lines l
      join public.bank_statement_imports original on original.id=l.statement_import_id
      where l.duplicate_of_line_id is null and original.status<>'void' and original.company_id=s.company_id
      and l.bank_account_id=new.bank_account_id and l.transaction_date=new.transaction_date and l.amount=new.amount
      and public.bank_import_text(l.reference_number)=public.bank_import_text(new.reference_number)
      and public.bank_import_text(l.description)=public.bank_import_text(new.description)
      order by original.created_at,l.created_at,l.id offset occurrence limit 1;
    if canonical is not null then
      insert into public.bank_statement_transaction_members(statement_import_id,source_hash,statement_line_id)
        values(new.statement_import_id,new.external_hash,canonical);
      insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,reason,performed_by)
        values(s.company_id,'bank_statement_import',s.id,'reuse_existing_bank_transaction',
          jsonb_build_object('statement_line_id',canonical,'source_hash',new.external_hash),
          'Already imported; existing reconciliation preserved',s.created_by);
      return null; -- No new bank row, payment, receipt or reconciliation.
    end if;
  end if;
  return new;
end $$;
create trigger reuse_imported_bank_transaction before insert on public.bank_statement_lines
  for each row execute function public.reuse_imported_bank_transaction();

create function public.record_bank_statement_membership() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  insert into public.bank_statement_transaction_members(statement_import_id,source_hash,statement_line_id)
    values(new.statement_import_id,new.external_hash,new.id);
  return new;
end $$;
create trigger record_bank_statement_membership after insert on public.bank_statement_lines
  for each row execute function public.record_bank_statement_membership();

create function public.protect_duplicate_bank_line() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if tg_table_name='bank_reconciliation_matches' then
    if exists(select 1 from public.bank_statement_lines where id=new.statement_line_id and duplicate_of_line_id is not null) then
      raise exception 'ALREADY IMPORTED: reconcile only the original bank transaction';
    end if;
  elsif old.duplicate_of_line_id is not null and new is distinct from old then
    raise exception 'Duplicate bank import is retained for audit and cannot be reopened';
  end if;
  return new;
end $$;
create trigger protect_duplicate_bank_line before update on public.bank_statement_lines
  for each row execute function public.protect_duplicate_bank_line();
create trigger protect_duplicate_bank_match before insert or update on public.bank_reconciliation_matches
  for each row execute function public.protect_duplicate_bank_line();

-- Full source-statement movements still include reused transactions, once each.
-- Work belongs to the original line's statement only; other imports show a summary.
create view public.bank_statement_transactions with (security_invoker=true) as
select l.id,m.statement_import_id,l.statement_import_id original_statement_import_id,
  l.bank_account_id,l.transaction_date,l.value_date,l.description,l.reference_number,l.amount,l.status,l.ignored_reason,
  (m.statement_import_id<>l.statement_import_id) is_reused,
  case when m.statement_import_id=l.statement_import_id then 'NEW'
    when l.status in ('matched','adjusted') then 'ALREADY RECONCILED' else 'ALREADY IMPORTED' end import_result
from public.bank_statement_transaction_members m join public.bank_statement_lines l on l.id=m.statement_line_id;
revoke all on public.bank_statement_transactions from public,anon;
grant select on public.bank_statement_transactions to authenticated,service_role;
revoke all on function public.reuse_imported_bank_transaction(),public.record_bank_statement_membership(),public.protect_duplicate_bank_line() from public,anon,authenticated;
grant execute on function public.reuse_imported_bank_transaction(),public.record_bank_statement_membership(),public.protect_duplicate_bank_line() to service_role;
