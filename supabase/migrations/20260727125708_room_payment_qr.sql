alter table public.rooms
  add column if not exists payment_qr_path text;

comment on column public.rooms.payment_qr_path is
  'Private Storage object path for the payment QR assigned to this room.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'room-payment-qr',
  'room-payment-qr',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
