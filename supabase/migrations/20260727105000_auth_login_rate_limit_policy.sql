drop policy if exists "auth_login_rate_limits_service_role"
  on public.auth_login_rate_limits;

create policy "auth_login_rate_limits_service_role"
on public.auth_login_rate_limits
for all
to service_role
using (true)
with check (true);
