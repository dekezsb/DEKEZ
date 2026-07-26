revoke all on function public.create_property_with_rooms(
  uuid,
  text,
  text,
  text,
  integer,
  boolean,
  uuid
) from public, anon;

grant execute on function public.create_property_with_rooms(
  uuid,
  text,
  text,
  text,
  integer,
  boolean,
  uuid
) to authenticated;
