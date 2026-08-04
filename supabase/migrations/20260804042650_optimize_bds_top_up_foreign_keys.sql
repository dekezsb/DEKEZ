-- Cover every foreign-key lookup used by the BDS top-up audit workflow.
create index if not exists smart_meter_top_up_property_idx
  on public.smart_meter_top_up_requests (property_id);

create index if not exists smart_meter_top_up_room_idx
  on public.smart_meter_top_up_requests (room_id);

create index if not exists smart_meter_top_up_tenancy_idx
  on public.smart_meter_top_up_requests (tenancy_id);

create index if not exists smart_meter_top_up_tenant_record_idx
  on public.smart_meter_top_up_requests (tenant_record_id);

create index if not exists smart_meter_top_up_meter_idx
  on public.smart_meter_top_up_requests (meter_id);

create index if not exists smart_meter_top_up_verified_by_idx
  on public.smart_meter_top_up_requests (verified_by);

create index if not exists smart_meter_top_up_credited_by_idx
  on public.smart_meter_top_up_requests (credited_by);
