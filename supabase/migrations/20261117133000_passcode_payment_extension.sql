-- Record which verified payment last extended a TTLock door passcode so the
-- same slip cannot add another month if it is verified or re-checked again.
-- Presentation of verified electricity top-ups on monthly invoices is handled
-- in application code and does not need a schema change.
alter table public.smart_lock_access_grants
  add column if not exists last_extension_reference text;

comment on column public.smart_lock_access_grants.last_extension_reference is
  'Payment submission ID that last extended this passcode. Used for idempotent monthly extensions after staff verification.';
