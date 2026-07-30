-- Keep every signed-in portal aligned with Admin changes. Realtime still
-- applies each table's existing RLS policies before sending row changes.
alter publication supabase_realtime add table
  public.profiles,
  public.user_module_permissions,
  public.properties,
  public.units,
  public.rooms,
  public.tenant_applications,
  public.tenant_records,
  public.tenancies,
  public.tenancy_agreements,
  public.rent_bills,
  public.payment_submissions,
  public.payments,
  public.utility_bills,
  public.maintenance_tickets,
  public.maintenance_updates,
  public.claims,
  public.expenses,
  public.notifications;
