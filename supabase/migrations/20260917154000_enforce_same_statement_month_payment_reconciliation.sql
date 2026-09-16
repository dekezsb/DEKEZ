-- A tenant payment can only be linked to a bank line from the same statement month.
-- This does not create, alter, or duplicate tenant receipts, payments, AR, or journals.

create or replace function public.guard_existing_payment_bank_match()
returns trigger language plpgsql set search_path=public as $$
declare
  p public.payments%rowtype;
  l public.bank_statement_lines%rowtype;
  company uuid;
  statement_month date;
begin
  select * into l from public.bank_statement_lines where id=new.statement_line_id;
  select company_id, date_trunc('month', period_start)::date
    into company, statement_month
  from public.bank_statement_imports
  where id=l.statement_import_id;

  perform pg_advisory_xact_lock(hashtextextended(company::text, 1801));

  if l.amount > 0 and exists (
    select 1 from public.bank_reconciliation_matches
    where statement_line_id=l.id and id<>new.id
  ) then
    raise exception 'Possible duplicate transaction. Please review.';
  end if;

  if new.source_type='payment' then
    select * into p from public.payments where id=new.source_id;
    if p.id is null
      or p.company_id<>company
      or p.status<>'confirmed'
      or p.reversed_at is not null
      or p.amount<=0
      or l.amount<>p.amount
      or new.matched_amount<>p.amount then
      raise exception 'Select an existing confirmed payment with the same bank amount. No payment will be created.';
    end if;

    if date_trunc('month', p.payment_date)::date is distinct from statement_month then
      raise exception 'Payment must be from the same statement month. No match was created.';
    end if;

    if p.rent_bill_id is not null and exists (
      select 1
      from public.rent_bills b
      where b.id=p.rent_bill_id
        and date_trunc('month', b.bill_month)::date is distinct from statement_month
    ) then
      raise exception 'Rental invoice must be from the same statement month. No match was created.';
    end if;

    if exists (
      select 1 from public.bank_reconciliation_matches m
      where m.id<>new.id
        and (
          (m.source_type='payment' and m.source_id=p.id)
          or (m.source_type='rent_bill' and m.source_id=p.rent_bill_id)
        )
    ) then
      raise exception 'Possible duplicate transaction. Please review.';
    end if;

    if exists (
      select 1
      from public.bank_statement_lines other
      join public.bank_reconciliation_matches m on m.statement_line_id=other.id
      where other.id<>l.id
        and other.bank_account_id=l.bank_account_id
        and other.transaction_date=l.transaction_date
        and other.amount=l.amount
        and (
          (nullif(trim(l.reference_number),'') is not null and other.reference_number=l.reference_number)
          or (nullif(trim(l.description),'') is not null and other.description=l.description)
        )
    ) or exists (
      select 1
      from public.payments other
      join public.bank_reconciliation_matches m on m.source_type='payment' and m.source_id=other.id
      where other.id<>p.id
        and other.company_id=p.company_id
        and other.amount=p.amount
        and other.payment_date=p.payment_date
        and nullif(trim(p.reference_number),'') is not null
        and other.reference_number=p.reference_number
    ) then
      raise exception 'Possible duplicate transaction. Please review.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.reconcile_existing_tenant_payment(
  p_company uuid,
  p_line uuid,
  p_payment uuid,
  p_actor uuid
)
returns uuid language plpgsql security invoker set search_path=public as $$
declare
  l public.bank_statement_lines%rowtype;
  match_id uuid;
  statement_month date;
  payment_month date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));

  if not exists (
    select 1 from public.profiles
    where id=p_actor and role in ('super_admin','admin','owner')
  ) then
    raise exception 'Not authorized';
  end if;

  select l0.* into l
  from public.bank_statement_lines l0
  join public.bank_statement_imports s on s.id=l0.statement_import_id
  where l0.id=p_line
    and s.company_id=p_company
    and s.status='in_progress'
  for update of l0;

  if l.id is null or l.amount<=0 or l.status<>'unmatched' then
    raise exception 'Possible duplicate transaction. Please review.';
  end if;

  select date_trunc('month', s.period_start)::date into statement_month
  from public.bank_statement_lines l0
  join public.bank_statement_imports s on s.id=l0.statement_import_id
  where l0.id=p_line and s.company_id=p_company;

  select date_trunc('month', p.payment_date)::date into payment_month
  from public.payments p
  where p.id=p_payment and p.company_id=p_company;

  if payment_month is null
    or statement_month is null
    or payment_month<>statement_month then
    raise exception 'Payment must be from the same statement month. No match was created.';
  end if;

  if exists (
    select 1
    from public.payments p
    join public.rent_bills b on b.id=p.rent_bill_id
    where p.id=p_payment
      and date_trunc('month', b.bill_month)::date is distinct from statement_month
  ) then
    raise exception 'Rental invoice must be from the same statement month. No match was created.';
  end if;

  if exists (
    select 1 from public.accounting_payment_reconciliations
    where payment_record_id=p_payment and bank_transaction_id is not null
  ) then
    raise exception 'Possible duplicate transaction. Please review.';
  end if;

  insert into public.bank_reconciliation_matches(
    statement_line_id, source_type, source_id, matched_amount, match_method, created_by
  )
  values(p_line,'payment',p_payment,l.amount,'manual',p_actor)
  returning id into match_id;

  insert into public.accounting_payment_reconciliations(
    payment_record_id, company_id, bank_transaction_id, reconciliation_status, reconciled_at, reconciled_by
  )
  values(p_payment,p_company,p_line,'RECONCILED',now(),p_actor)
  on conflict(payment_record_id) do update
    set bank_transaction_id=p_line,
        reconciliation_status='RECONCILED',
        reconciled_at=now(),
        reconciled_by=p_actor,
        updated_at=now();

  update public.bank_statement_lines
  set status='matched',updated_at=now()
  where id=p_line;

  insert into public.accounting_audit_logs(
    company_id, entity_type, entity_id, action, after_data, performed_by, reason
  )
  values(
    p_company,
    'payment_reconciliation',
    match_id,
    'reconciled',
    jsonb_build_object('bank_transaction_id',p_line,'payment_record_id',p_payment),
    p_actor,
    'Linked existing payment only. No receipt, payment, AR or journal created.'
  );

  return match_id;
end;
$$;

revoke all on function public.reconcile_existing_tenant_payment(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_existing_tenant_payment(uuid,uuid,uuid,uuid) to service_role;
