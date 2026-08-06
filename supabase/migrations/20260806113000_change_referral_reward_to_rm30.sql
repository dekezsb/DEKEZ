do $$
declare
  v_promotion_id uuid;
begin
  select id
  into v_promotion_id
  from public.referral_promotions
  where start_date = date '2026-08-01'
    and end_date = date '2026-08-31'
    and promotion_name in (
      'Invite a Friend & Earn RM50',
      'Invite a Friend & Earn RM30'
    )
  order by created_at desc
  limit 1;

  if v_promotion_id is null then
    raise exception 'August 2026 referral promotion was not found';
  end if;

  update public.referral_promotions
  set promotion_name = 'Invite a Friend & Earn RM30',
      reward_amount = 30.00,
      updated_at = now()
  where id = v_promotion_id;

  update public.tenant_referrals
  set reward_amount = 30.00,
      updated_at = now()
  where promotion_id = v_promotion_id
    and status in ('pending', 'approved');

  update public.rental_credits credit
  set original_amount = 30.00,
      remaining_amount = 30.00,
      updated_at = now()
  from public.tenant_referrals referral
  where referral.id = credit.referral_id
    and referral.promotion_id = v_promotion_id
    and credit.status = 'available'
    and credit.original_amount = credit.remaining_amount;
end;
$$;
