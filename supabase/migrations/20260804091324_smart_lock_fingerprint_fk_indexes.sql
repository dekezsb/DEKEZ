create index if not exists smart_lock_fingerprint_company_idx
  on public.smart_lock_fingerprint_grants (company_id);

create index if not exists smart_lock_fingerprint_property_idx
  on public.smart_lock_fingerprint_grants (property_id);

create index if not exists smart_lock_fingerprint_room_idx
  on public.smart_lock_fingerprint_grants (room_id)
  where room_id is not null;

create index if not exists smart_lock_fingerprint_tenant_profile_idx
  on public.smart_lock_fingerprint_grants (tenant_profile_id);

create index if not exists smart_lock_fingerprint_audit_device_idx
  on public.smart_lock_fingerprint_audit_logs (device_id, occurred_at desc);

create index if not exists smart_lock_fingerprint_audit_payment_idx
  on public.smart_lock_fingerprint_audit_logs (payment_submission_id)
  where payment_submission_id is not null;

create index if not exists smart_lock_fingerprint_audit_actor_idx
  on public.smart_lock_fingerprint_audit_logs (performed_by)
  where performed_by is not null;
