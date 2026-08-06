create index if not exists referral_promotions_created_by_idx
  on public.referral_promotions (created_by) where created_by is not null;
create index if not exists referral_promotions_updated_by_idx
  on public.referral_promotions (updated_by) where updated_by is not null;

create index if not exists tenant_referrals_company_idx
  on public.tenant_referrals (company_id);
create index if not exists tenant_referrals_property_idx
  on public.tenant_referrals (property_id);
create index if not exists tenant_referrals_room_idx
  on public.tenant_referrals (room_id);
create index if not exists tenant_referrals_approved_by_idx
  on public.tenant_referrals (approved_by) where approved_by is not null;
create index if not exists tenant_referrals_applied_by_idx
  on public.tenant_referrals (applied_by) where applied_by is not null;
create index if not exists tenant_referrals_applied_invoice_idx
  on public.tenant_referrals (applied_invoice_id) where applied_invoice_id is not null;

create index if not exists rental_credits_company_idx
  on public.rental_credits (company_id);
create index if not exists rental_credit_applications_applied_by_idx
  on public.rental_credit_applications (applied_by) where applied_by is not null;

create index if not exists referral_audit_logs_invoice_idx
  on public.referral_audit_logs (invoice_applied_id) where invoice_applied_id is not null;
create index if not exists referral_audit_logs_applied_by_idx
  on public.referral_audit_logs (applied_by) where applied_by is not null;
