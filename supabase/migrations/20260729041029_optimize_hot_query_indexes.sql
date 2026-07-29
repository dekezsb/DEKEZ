create index if not exists rent_bills_property_month_status_idx
  on public.rent_bills (property_id, bill_month, status)
  where removed_at is null;

create index if not exists rent_bills_due_status_idx
  on public.rent_bills (due_date, status)
  where removed_at is null;

create index if not exists payments_rent_bill_status_date_idx
  on public.payments (rent_bill_id, status, payment_date desc)
  where rent_bill_id is not null;

create index if not exists tenant_records_property_status_room_idx
  on public.tenant_records (property_id, status, room_id);

create index if not exists tenancies_property_status_room_idx
  on public.tenancies (property_id, status, room_id);
