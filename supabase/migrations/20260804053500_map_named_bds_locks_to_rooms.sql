-- The numbered TTLock aliases identify their physical BDS rooms.
-- The main-office lock remains attached to the property, not a tenant room.
update public.smart_lock_devices as device
set
  room_id = room.id,
  updated_at = now()
from public.rooms as room
join public.properties as property on property.id = room.property_id
join (
  values
    ('bds-office-2', 'Room 2'),
    ('bds-office-5', 'Room 5'),
    ('bds-office-6', 'Room 6')
) as mapping(onboarding_key, room_number)
  on mapping.room_number = room.room_number
where device.property_id = property.id
  and device.company_id = property.company_id
  and upper(coalesce(property.property_code, '')) = 'BDS'
  and device.provider = 'ttlock'
  and device.onboarding_key = mapping.onboarding_key
  and device.room_id is null;
