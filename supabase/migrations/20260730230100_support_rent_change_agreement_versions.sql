alter table public.tenancy_rent_adjustments
  drop constraint if exists tenancy_rent_adjustments_agreement_sync_status_check;

alter table public.tenancy_rent_adjustments
  add constraint tenancy_rent_adjustments_agreement_sync_status_check
  check (
    agreement_sync_status in (
      'updated_unsigned',
      'created_amendment',
      'signed_history_preserved',
      'not_found',
      'not_required'
    )
  );
