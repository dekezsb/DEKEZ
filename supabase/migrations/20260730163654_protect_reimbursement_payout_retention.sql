create or replace function public.prevent_early_reimbursement_payout_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.retain_until > current_date then
    raise exception 'reimbursement_payout_retained_until_%', old.retain_until;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_reimbursement_payouts_retain_seven_years
  on public.staff_reimbursement_payouts;
create trigger staff_reimbursement_payouts_retain_seven_years
before update or delete on public.staff_reimbursement_payouts
for each row
execute function public.prevent_early_reimbursement_payout_mutation();

revoke all on function public.prevent_early_reimbursement_payout_mutation()
  from public, anon, authenticated;

comment on function public.prevent_early_reimbursement_payout_mutation() is
  'Keeps each payout batch and its proof reference immutable until its seven-year retention date.';
