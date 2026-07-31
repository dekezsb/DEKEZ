alter table public.staff_reimbursement_liabilities
  alter column claim_id drop not null;

create or replace function public.sync_staff_reimbursement_liability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_staff_id uuid;
begin
  if new.status = 'verified'
    and new.funding_source = 'staff_personal'
    and coalesce(new.amount, 0) > 0
  then
    if new.claim_id is not null then
      select claims.submitted_by
      into target_staff_id
      from public.claims
      where claims.id = new.claim_id;
    end if;

    target_staff_id :=
      coalesce(target_staff_id, new.paid_by, new.uploaded_by);

    if target_staff_id is null then
      raise exception 'staff_reimbursement_payee_required';
    end if;

    insert into public.staff_reimbursement_liabilities (
      claim_id,
      expense_id,
      staff_id,
      amount,
      status,
      owed_at
    )
    values (
      new.claim_id,
      new.id,
      target_staff_id,
      new.amount,
      'owed',
      coalesce(new.verified_at, now())
    )
    on conflict (expense_id) do update
    set
      claim_id = excluded.claim_id,
      staff_id = excluded.staff_id,
      amount = excluded.amount,
      updated_at = now()
    where public.staff_reimbursement_liabilities.status = 'owed';

    return new;
  end if;

  delete from public.staff_reimbursement_liabilities
  where expense_id = new.id
    and status = 'owed';

  return new;
end;
$$;

drop trigger if exists expenses_sync_staff_reimbursement_liability
  on public.expenses;
create trigger expenses_sync_staff_reimbursement_liability
after insert or update of
  status,
  funding_source,
  amount,
  paid_by,
  uploaded_by,
  claim_id
on public.expenses
for each row
execute function public.sync_staff_reimbursement_liability();

revoke all on function public.sync_staff_reimbursement_liability()
  from public, anon, authenticated;

insert into public.staff_reimbursement_liabilities (
  claim_id,
  expense_id,
  staff_id,
  amount,
  status,
  owed_at
)
select
  expenses.claim_id,
  expenses.id,
  coalesce(claims.submitted_by, expenses.paid_by, expenses.uploaded_by),
  expenses.amount,
  'owed',
  coalesce(expenses.verified_at, expenses.created_at, now())
from public.expenses
left join public.claims
  on claims.id = expenses.claim_id
where expenses.status = 'verified'
  and expenses.funding_source = 'staff_personal'
  and expenses.amount > 0
  and coalesce(
    claims.submitted_by,
    expenses.paid_by,
    expenses.uploaded_by
  ) is not null
on conflict (expense_id) do update
set
  claim_id = excluded.claim_id,
  staff_id = excluded.staff_id,
  amount = excluded.amount,
  updated_at = now()
where public.staff_reimbursement_liabilities.status = 'owed';

create or replace function public.record_staff_reimbursement_payout(
  target_staff_id uuid,
  liability_ids uuid[],
  payout_source text,
  payout_date date,
  payout_reference text,
  payout_notes text,
  payout_proof_bucket text,
  payout_proof_path text,
  payout_proof_content_type text,
  payout_recorded_by uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_payout_id uuid;
  selected_count integer;
  selected_total numeric(12, 2);
begin
  if target_staff_id is null
    or payout_recorded_by is null
    or payout_date is null
    or payout_source not in ('company_cash', 'company_bank')
    or coalesce(cardinality(liability_ids), 0) = 0
    or nullif(btrim(payout_proof_bucket), '') is null
    or nullif(btrim(payout_proof_path), '') is null
  then
    raise exception 'invalid_reimbursement_payout';
  end if;

  perform 1
  from public.staff_reimbursement_liabilities
  where id = any(liability_ids)
  for update;

  select count(*), coalesce(sum(amount), 0)
  into selected_count, selected_total
  from public.staff_reimbursement_liabilities
  where id = any(liability_ids)
    and staff_id = target_staff_id
    and status = 'owed'
    and payout_id is null;

  if selected_count <> cardinality(liability_ids)
    or selected_total <= 0
  then
    raise exception 'reimbursement_items_changed';
  end if;

  insert into public.staff_reimbursement_payouts (
    staff_id,
    total_amount,
    payment_source,
    paid_on,
    reference_number,
    notes,
    proof_bucket_name,
    proof_file_path,
    proof_content_type,
    recorded_by
  )
  values (
    target_staff_id,
    selected_total,
    payout_source,
    payout_date,
    nullif(btrim(payout_reference), ''),
    nullif(btrim(payout_notes), ''),
    payout_proof_bucket,
    payout_proof_path,
    nullif(btrim(payout_proof_content_type), ''),
    payout_recorded_by
  )
  returning id into new_payout_id;

  update public.staff_reimbursement_liabilities
  set
    status = 'paid',
    payout_id = new_payout_id,
    paid_at = now(),
    updated_at = now()
  where id = any(liability_ids)
    and staff_id = target_staff_id
    and status = 'owed'
    and payout_id is null;

  if not found then
    raise exception 'reimbursement_items_changed';
  end if;

  update public.expenses
  set
    status = 'reimbursed',
    payment_status = 'paid',
    paid_at = now(),
    reimbursement_source = payout_source,
    reimbursed_at = now(),
    updated_at = now()
  where id in (
    select expense_id
    from public.staff_reimbursement_liabilities
    where payout_id = new_payout_id
  );

  update public.claims
  set
    status = 'paid',
    updated_at = now()
  where id in (
    select claim_id
    from public.staff_reimbursement_liabilities
    where payout_id = new_payout_id
      and claim_id is not null
  );

  return new_payout_id;
end;
$$;

revoke all on function public.record_staff_reimbursement_payout(
  uuid,
  uuid[],
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.record_staff_reimbursement_payout(
  uuid,
  uuid[],
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  uuid
) to service_role;

comment on table public.staff_reimbursement_liabilities is
  'One audited company-payable liability for every verified expense funded with staff personal money.';

comment on function public.sync_staff_reimbursement_liability() is
  'Keeps the staff AP ledger aligned with every verified staff-funded expense.';
