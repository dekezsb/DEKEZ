create index if not exists tenancy_rent_adjustments_room_idx
  on public.tenancy_rent_adjustments (room_id);

create index if not exists tenancy_rent_adjustments_agreement_idx
  on public.tenancy_rent_adjustments (agreement_id);

create index if not exists tenancy_rent_adjustments_approved_by_idx
  on public.tenancy_rent_adjustments (approved_by);
