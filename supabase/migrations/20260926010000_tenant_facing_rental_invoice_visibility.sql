-- QR reconciliation may need to create/keep a rental invoice purely for admin/
-- accounting reconciliation purposes (e.g. a bank transaction for a room's
-- already-checked-out former tenant). Every existing tenant/admin-facing
-- surface (portal, WhatsApp bot, reminder cron, admin Rental Invoice archive)
-- has no way to express "this invoice exists, but must not surface as a new
-- outstanding bill to a tenant". Adding an explicit column rather than
-- reusing 'draft' status, because 'draft' is already excluded from the
-- reconciliation invoice list itself (app/reports/page.tsx openBills) and
-- from revenue/receivables reporting - it would make a reconciliation-only
-- invoice invisible to the very reconciliation screen that needs it.
--
-- Default true preserves current behaviour for every existing row and every
-- normal invoice going forward; nothing changes unless a caller explicitly
-- sets it to false.
alter table public.rent_bills
  add column if not exists tenant_facing boolean not null default true;

comment on column public.rent_bills.tenant_facing is
  'false = admin/accounting-only invoice (e.g. a historical invoice created during bank reconciliation for an already checked-out tenant). Must never surface as a new outstanding bill on the tenant portal, WhatsApp bot, or rent-reminder cron. true = normal invoice, unchanged behaviour.';
