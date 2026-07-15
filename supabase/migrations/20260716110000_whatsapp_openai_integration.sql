create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references auth.users(id) on delete set null,
  phone_number text not null,
  normalized_phone text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'blocked')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_phone)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  tenant_id uuid references auth.users(id) on delete set null,
  phone_number text not null,
  normalized_phone text not null,
  direction text not null check (direction in ('incoming', 'outgoing')),
  meta_message_id text unique,
  message_type text not null default 'text',
  message_text text,
  media_id text,
  media_mime_type text,
  media_file_path text,
  processing_status text not null default 'received' check (
    processing_status in ('received', 'processing', 'processed', 'duplicate', 'failed', 'sent')
  ),
  error_message text,
  meta_timestamp timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

drop policy if exists "whatsapp_conversations_select_allowed" on public.whatsapp_conversations;
create policy "whatsapp_conversations_select_allowed" on public.whatsapp_conversations
for select using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
);

drop policy if exists "whatsapp_messages_select_allowed" on public.whatsapp_messages;
create policy "whatsapp_messages_select_allowed" on public.whatsapp_messages
for select using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
);

drop policy if exists "whatsapp_media_storage_select_allowed" on storage.objects;
create policy "whatsapp_media_storage_select_allowed" on storage.objects
for select using (
  bucket_id = 'whatsapp-media'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);
