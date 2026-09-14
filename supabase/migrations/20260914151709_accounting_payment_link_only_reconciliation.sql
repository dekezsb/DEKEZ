-- Internal accounting state only. No trigger or write to tenant receipts/payments.
create table public.accounting_payment_reconciliations (
  payment_record_id uuid primary key references public.payments(id),
  company_id uuid not null references public.companies(id),
  bank_transaction_id uuid unique references public.bank_statement_lines(id),
  reconciliation_status text not null default 'PENDING' check (reconciliation_status in ('PENDING','MATCH_SUGGESTED','RECONCILED','UNMATCHED','MANUAL_REVIEW')),
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check ((reconciliation_status = 'RECONCILED') = (bank_transaction_id is not null))
);
alter table public.accounting_payment_reconciliations enable row level security;
revoke all on public.accounting_payment_reconciliations from anon, authenticated;
grant all on public.accounting_payment_reconciliations to service_role;
insert into public.accounting_payment_reconciliations(payment_record_id,company_id)
select id,company_id from public.payments;

-- Mirror only unambiguous, already-existing one-to-one links. Never create a match.
update public.accounting_payment_reconciliations r set
  bank_transaction_id=m.statement_line_id,reconciliation_status='RECONCILED',reconciled_at=m.created_at,reconciled_by=m.created_by
from public.bank_reconciliation_matches m join public.payments p on m.source_type='payment' and p.id=m.source_id
join public.bank_statement_lines l on l.id=m.statement_line_id
where r.payment_record_id=p.id and p.amount=l.amount and m.matched_amount=p.amount
  and (select count(*) from public.bank_reconciliation_matches x where x.source_type='payment' and x.source_id=p.id)=1
  and (select count(*) from public.bank_reconciliation_matches x where x.statement_line_id=l.id)=1;
update public.accounting_payment_reconciliations r set reconciliation_status='MANUAL_REVIEW'
where bank_transaction_id is null and exists(select 1 from public.bank_reconciliation_matches m join public.payments p on p.id=r.payment_record_id
  where (m.source_type='payment' and m.source_id=p.id) or (m.source_type='rent_bill' and m.source_id=p.rent_bill_id));

-- Serialize matching within a company, including older reconciliation routes.
create function public.guard_existing_payment_bank_match()
returns trigger language plpgsql set search_path=public as $$
declare p public.payments%rowtype; l public.bank_statement_lines%rowtype; company uuid;
begin
  select * into l from public.bank_statement_lines where id=new.statement_line_id;
  select company_id into company from public.bank_statement_imports where id=l.statement_import_id;
  perform pg_advisory_xact_lock(hashtextextended(company::text, 1801));
  if l.amount > 0 and exists (select 1 from public.bank_reconciliation_matches where statement_line_id=l.id and id<>new.id) then
    raise exception 'Possible duplicate transaction. Please review.';
  end if;
  if new.source_type='payment' then
    select * into p from public.payments where id=new.source_id;
    if p.id is null or p.company_id<>company or p.status<>'confirmed' or p.reversed_at is not null
       or p.amount<=0 or l.amount<>p.amount or new.matched_amount<>p.amount then
      raise exception 'Select an existing confirmed payment with the same bank amount. No payment will be created.';
    end if;
    if exists(select 1 from public.bank_reconciliation_matches m where m.id<>new.id and (
        (m.source_type='payment' and m.source_id=p.id)
        or (m.source_type='rent_bill' and m.source_id=p.rent_bill_id))) then
      raise exception 'Possible duplicate transaction. Please review.';
    end if;
    if exists(select 1 from public.bank_statement_lines other join public.bank_reconciliation_matches m on m.statement_line_id=other.id
        where other.id<>l.id and other.bank_account_id=l.bank_account_id and other.transaction_date=l.transaction_date
        and other.amount=l.amount and ((nullif(trim(l.reference_number),'') is not null and other.reference_number=l.reference_number)
          or (nullif(trim(l.description),'') is not null and other.description=l.description)))
      or exists(select 1 from public.payments other join public.bank_reconciliation_matches m on m.source_type='payment' and m.source_id=other.id
        where other.id<>p.id and other.company_id=p.company_id and other.amount=p.amount and other.payment_date=p.payment_date
        and nullif(trim(p.reference_number),'') is not null and other.reference_number=p.reference_number) then
      raise exception 'Possible duplicate transaction. Please review.';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_existing_payment_bank_match before insert or update on public.bank_reconciliation_matches
for each row execute function public.guard_existing_payment_bank_match();

create function public.reconcile_existing_tenant_payment(p_company uuid,p_line uuid,p_payment uuid,p_actor uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare l public.bank_statement_lines%rowtype; match_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  if not exists(select 1 from public.profiles where id=p_actor and role in ('super_admin','admin','owner')) then raise exception 'Not authorized'; end if;
  select l0.* into l from public.bank_statement_lines l0 join public.bank_statement_imports s on s.id=l0.statement_import_id
    where l0.id=p_line and s.company_id=p_company and s.status='in_progress' for update of l0;
  if l.id is null or l.amount<=0 or l.status<>'unmatched' then raise exception 'Possible duplicate transaction. Please review.'; end if;
  if exists(select 1 from public.accounting_payment_reconciliations where payment_record_id=p_payment and bank_transaction_id is not null) then
    raise exception 'Possible duplicate transaction. Please review.';
  end if;
  insert into public.bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by)
    values(p_line,'payment',p_payment,l.amount,'manual',p_actor) returning id into match_id;
  insert into public.accounting_payment_reconciliations(payment_record_id,company_id,bank_transaction_id,reconciliation_status,reconciled_at,reconciled_by)
    values(p_payment,p_company,p_line,'RECONCILED',now(),p_actor)
    on conflict(payment_record_id) do update set bank_transaction_id=p_line,reconciliation_status='RECONCILED',reconciled_at=now(),reconciled_by=p_actor,updated_at=now();
  update public.bank_statement_lines set status='matched',updated_at=now() where id=p_line;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,performed_by,reason)
    values(p_company,'payment_reconciliation',match_id,'reconciled',jsonb_build_object('bank_transaction_id',p_line,'payment_record_id',p_payment),p_actor,'Linked existing payment only. No receipt, payment, AR or journal created.');
  return match_id;
end;
$$;
create function public.unreconcile_existing_tenant_payment(p_company uuid,p_payment uuid,p_actor uuid,p_reason text)
returns void language plpgsql security invoker set search_path=public as $$
declare link public.accounting_payment_reconciliations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  if not exists(select 1 from public.profiles where id=p_actor and role in ('super_admin','admin')) or length(trim(p_reason))<3 then raise exception 'Authorized admin and reason required'; end if;
  select * into link from public.accounting_payment_reconciliations where payment_record_id=p_payment and company_id=p_company for update;
  if link.bank_transaction_id is null then raise exception 'No reconciled link'; end if;
  delete from public.bank_reconciliation_matches where statement_line_id=link.bank_transaction_id and source_type='payment' and source_id=p_payment;
  update public.accounting_payment_reconciliations set bank_transaction_id=null,reconciliation_status='UNMATCHED',reconciled_at=null,reconciled_by=null,updated_at=now() where payment_record_id=p_payment;
  update public.bank_statement_lines set status='unmatched',updated_at=now() where id=link.bank_transaction_id;
  update public.bank_statement_imports set status='in_progress',updated_at=now() where id=(select statement_import_id from public.bank_statement_lines where id=link.bank_transaction_id);
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,performed_by,reason)
    values(p_company,'payment_reconciliation',p_payment,'unmatched',to_jsonb(link),p_actor,p_reason);
end;
$$;
revoke all on function public.reconcile_existing_tenant_payment(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.unreconcile_existing_tenant_payment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reconcile_existing_tenant_payment(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.unreconcile_existing_tenant_payment(uuid,uuid,uuid,text) to service_role;
