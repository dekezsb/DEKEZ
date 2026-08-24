alter table public.user_module_permissions
  drop constraint if exists user_module_permissions_module_key_check;

alter table public.user_module_permissions
  add constraint user_module_permissions_module_key_check check (
    module_key = any (
      array[
        'dashboard'::text,
        'admin_setup'::text,
        'properties'::text,
        'verification'::text,
        'payments'::text,
        'rent_due_tracker'::text,
        'tenancy_agreements'::text,
        'utility_bills'::text,
        'expenses'::text,
        'maintenance'::text,
        'claims'::text,
        'tenant_checkout'::text,
        'reports'::text,
        'settings'::text,
        'onboarding'::text
      ]
    )
  );

create index if not exists audit_logs_tenant_checkout_created_idx
  on public.audit_logs (created_at desc)
  where action = 'tenant_checked_out';
