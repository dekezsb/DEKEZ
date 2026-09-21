-- Keep the original atomic allocator intact. Saving a reference and allocating a
-- booking fee succeed or roll back together. Old releases can still use it.
create or replace function public.verify_booking_fee_allocation_with_reference(
  p_submission uuid, p_actor uuid, p_allocation text, p_amount numeric,
  p_payment_date date, p_bank_reference text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.payment_submissions%rowtype;
  result jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_actor
    and (role = 'super_admin' or global_role = 'super_admin')) then
    raise exception 'Only Super Admin can allocate a booking fee';
  end if;
  if length(p_bank_reference) > 120 or p_bank_reference ~ '[[:cntrl:]]' then
    raise exception 'Invalid bank reference';
  end if;
  select * into strict s from public.payment_submissions
    where id = p_submission for update;
  if s.verification_status <> 'verified' and nullif(btrim(p_bank_reference), '') is not null then
    update public.payment_submissions set reference_number = btrim(p_bank_reference)
      where id = s.id;
  end if;
  result := public.verify_booking_fee_allocation(
    p_submission, p_actor, p_allocation, p_amount, p_payment_date);
  -- A retry cannot change an already verified reference or create another payment.
  return result;
end;
$$;
revoke all on function public.verify_booking_fee_allocation_with_reference(uuid, uuid, text, numeric, date, text)
  from public, anon, authenticated;
grant execute on function public.verify_booking_fee_allocation_with_reference(uuid, uuid, text, numeric, date, text)
  to service_role;
