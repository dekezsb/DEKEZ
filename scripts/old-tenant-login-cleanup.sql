-- Old-tenant login cleanup (approved by JV on 24 Nov 2026, run once that day
-- for 29 tenants). Re-runnable. Run the PREVIEW first; run APPLY only with
-- management approval. Records (tenants, tenancies, bills, payments) are kept.
--
-- Old tenant = tenant profile, auth role tenant, no staff module permissions,
-- at least one ended + checked-out tenancy, and no active/draft tenancy and
-- no tenancy without a checkout date. Lifted automatically on move-in.

-- PREVIEW (read-only)
select p.id, p.full_name, pr.property_code, r.room_number, y.checkout_date
from public.profiles p
join auth.users u on u.id = p.id
join lateral (
  select y.* from public.tenancies y
  join public.tenants t on t.id = y.tenant_id
  where t.profile_id = p.id
  order by y.checkout_date desc nulls last limit 1
) y on true
left join public.properties pr on pr.id = y.property_id
left join public.rooms r on r.id = y.room_id
where p.role::text = 'tenant'
  and coalesce(u.raw_app_meta_data->>'role', 'tenant') = 'tenant'
  and (u.banned_until is null or u.banned_until < now())
  and not exists (select 1 from public.user_module_permissions m where m.profile_id = p.id)
  and exists (select 1 from public.tenants t join public.tenancies y2 on y2.tenant_id = t.id
              where t.profile_id = p.id and y2.status::text = 'ended' and y2.checkout_date is not null)
  and not exists (select 1 from public.tenants t join public.tenancies y2 on y2.tenant_id = t.id
                  where t.profile_id = p.id and (y2.status::text in ('active', 'draft') or y2.checkout_date is null))
order by 3, 4;

-- APPLY (writes; replace the id list with the reviewed PREVIEW ids)
-- with ok(id) as (values ('00000000-0000-0000-0000-000000000000'::uuid)),
-- b as (update auth.users u set banned_until = now() + interval '876000 hours',
--         raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
--           || jsonb_build_object('checkout_login_revoked_at', now(),
--                                 'checkout_login_revoked_source', 'old_tenant_cleanup')
--       from ok where u.id = ok.id returning u.id),
-- s as (delete from auth.sessions x using ok where x.user_id = ok.id returning x.id),
-- r as (delete from auth.refresh_tokens x using ok where x.user_id = ok.id::text returning x.id)
-- select (select count(*) from b) banned, (select count(*) from s) sessions, (select count(*) from r) tokens;

-- UNDO for one person (normally automatic at move-in/sign-in):
-- update auth.users set banned_until = null where id = '<auth user id>';
