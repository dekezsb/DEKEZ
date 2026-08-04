create index if not exists smart_lock_grants_company_idx
  on public.smart_lock_access_grants (company_id);

create index if not exists smart_lock_grants_property_idx
  on public.smart_lock_access_grants (property_id);

create index if not exists smart_lock_grants_room_idx
  on public.smart_lock_access_grants (room_id)
  where room_id is not null;
