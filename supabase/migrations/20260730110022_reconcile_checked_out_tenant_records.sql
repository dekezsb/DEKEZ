update public.tenant_records as tenant_record
set
  status = 'moved_out',
  contract_end = coalesce(
    tenant_record.contract_end,
    (
      select tenancy.checkout_date
      from public.tenancies as tenancy
      where tenancy.room_id = tenant_record.room_id
        and tenancy.status <> 'active'
        and tenancy.checkout_date is not null
      order by tenancy.checkout_date desc
      limit 1
    )
  ),
  updated_at = now()
where tenant_record.status = 'active'
  and exists (
    select 1
    from public.rooms as room
    where room.id = tenant_record.room_id
      and room.status = 'vacant'
  )
  and not exists (
    select 1
    from public.tenancies as tenancy
    where tenancy.room_id = tenant_record.room_id
      and tenancy.status = 'active'
      and tenancy.checkout_date is null
  );
