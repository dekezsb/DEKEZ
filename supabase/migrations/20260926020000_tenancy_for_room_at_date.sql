-- Nothing in this codebase can currently answer "which tenancy occupied room
-- X on date Y" (there is only getActiveTenancy(), which takes a tenant, not a
-- room, has no date parameter, and only ever looks at the live 'active' row).
-- QR reconciliation needs exactly this: a bank transaction dated, say, 15 Aug
-- 2026 for a room that changed tenants on 1 Sep 2026 must resolve to the
-- tenant who was actually there in August, not whoever occupies the room now.
--
-- Start/end precedence mirrors the existing, already-relied-upon precedence in
-- lib/billing/rent-billing.ts (effectiveEndDate / tenancyStartDate), so this
-- resolves tenancy periods exactly the same way the recurring billing engine
-- already does: check_in_date/checkout_date win when present, falling back to
-- tenancy_start_date/tenancy_end_date, then contract_start/contract_end, then
-- the always-populated start_date/end_date pair.
--
-- Read-only, no side effects. 'draft' tenancies (never actually started) are
-- excluded - a bank transaction can never belong to a tenancy that was never
-- confirmed.
create or replace function public.tenancy_for_room_at_date(p_room_id uuid, p_at date)
returns public.tenancies
language sql
stable
security invoker
set search_path = ''
as $$
  select t.*
  from public.tenancies t
  where t.room_id = p_room_id
    and t.status <> 'draft'
    and coalesce(t.check_in_date, t.tenancy_start_date, t.contract_start, t.start_date) <= p_at
    and (
      coalesce(t.checkout_date, t.tenancy_end_date, t.contract_end, t.end_date) is null
      or coalesce(t.checkout_date, t.tenancy_end_date, t.contract_end, t.end_date) >= p_at
    )
  order by coalesce(t.check_in_date, t.tenancy_start_date, t.contract_start, t.start_date) desc
  limit 1;
$$;

revoke all on function public.tenancy_for_room_at_date(uuid, date) from public, anon, authenticated;
grant execute on function public.tenancy_for_room_at_date(uuid, date) to service_role;
