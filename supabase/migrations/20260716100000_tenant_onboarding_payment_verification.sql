alter table public.properties
  add column if not exists contract_duration_options integer[] not null default array[6, 12];

alter type public.bill_status add value if not exists 'submitted';
alter type public.bill_status add value if not exists 'pending_verification';
alter type public.bill_status add value if not exists 'rejected';
alter type public.bill_status add value if not exists 'overdue';

create table if not exists public.tenant_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  full_name text not null,
  ic_passport_number text,
  nationality text,
  date_of_birth date,
  whatsapp_number text,
  emergency_contact_name text,
  emergency_contact_number text,
  contract_duration_months integer not null default 12 check (contract_duration_months in (6, 12)),
  proposed_start_date date not null default current_date,
  proposed_end_date date,
  monthly_rent numeric(12, 2) not null default 0,
  deposit numeric(12, 2) not null default 0,
  utility_deposit numeric(12, 2) not null default 0,
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'pending_verification', 'approved', 'rejected', 'converted_to_tenancy')),
  verification_status text not null default 'pending_verification' check (verification_status in ('incomplete', 'pending_verification', 'verified', 'rejected', 'more_information_required')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'submitted', 'pending_verification', 'verified', 'rejected', 'more_information_required')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_application_id uuid not null references public.tenant_applications(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('ic_front', 'ic_back', 'passport_photo_page')),
  file_path text not null,
  file_name text,
  content_type text,
  verification_status text not null default 'pending_verification' check (verification_status in ('pending_verification', 'verified', 'rejected', 'more_information_required')),
  uploaded_at timestamptz not null default now()
);

create table if not exists public.tenant_verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_application_id uuid not null references public.tenant_applications(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('verified', 'rejected', 'more_information_required')),
  notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now()
);

create table if not exists public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references auth.users(id) on delete cascade,
  tenant_application_id uuid references public.tenant_applications(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  rent_bill_id uuid references public.rent_bills(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  bill_month date,
  bill_type text not null default 'check_in',
  payment_type text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  payment_date date not null default current_date,
  payment_method text not null default 'bank_transfer',
  reference_number text,
  receipt_url text,
  verification_status text not null default 'pending_verification' check (verification_status in ('pending_verification', 'verified', 'rejected', 'more_information_required')),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    bill_type <> 'monthly_rent'
    or rent_bill_id is not null
  )
);

create table if not exists public.payment_attachments (
  id uuid primary key default gen_random_uuid(),
  payment_submission_id uuid not null references public.payment_submissions(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  file_path text not null,
  file_name text,
  content_type text,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values
  ('tenant-documents', 'tenant-documents', false),
  ('payment-receipts', 'payment-receipts', false)
on conflict (id) do nothing;

alter table public.tenant_applications enable row level security;
alter table public.tenant_documents enable row level security;
alter table public.tenant_verifications enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.payment_attachments enable row level security;

drop policy if exists "tenant_applications_select_allowed" on public.tenant_applications;
create policy "tenant_applications_select_allowed" on public.tenant_applications
for select using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
  or public.can_access_property(property_id)
);

drop policy if exists "tenant_applications_insert_own" on public.tenant_applications;
create policy "tenant_applications_insert_own" on public.tenant_applications
for insert with check (tenant_id = auth.uid());

drop policy if exists "tenant_applications_update_allowed" on public.tenant_applications;
create policy "tenant_applications_update_allowed" on public.tenant_applications
for update using (
  public.is_platform_admin()
  or public.can_access_property(property_id)
)
with check (
  public.is_platform_admin()
  or public.can_access_property(property_id)
);

drop policy if exists "tenant_documents_select_allowed" on public.tenant_documents;
create policy "tenant_documents_select_allowed" on public.tenant_documents
for select using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
);

drop policy if exists "tenant_documents_insert_own" on public.tenant_documents;
create policy "tenant_documents_insert_own" on public.tenant_documents
for insert with check (tenant_id = auth.uid());

drop policy if exists "tenant_verifications_select_allowed" on public.tenant_verifications;
create policy "tenant_verifications_select_allowed" on public.tenant_verifications
for select using (tenant_id = auth.uid() or public.is_platform_admin());

drop policy if exists "tenant_verifications_insert_admin" on public.tenant_verifications;
create policy "tenant_verifications_insert_admin" on public.tenant_verifications
for insert with check (public.is_platform_admin());

drop policy if exists "payment_submissions_select_allowed" on public.payment_submissions;
create policy "payment_submissions_select_allowed" on public.payment_submissions
for select using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
  or public.can_access_property(property_id)
);

drop policy if exists "payment_submissions_insert_own" on public.payment_submissions;
create policy "payment_submissions_insert_own" on public.payment_submissions
for insert with check (tenant_id = auth.uid());

drop policy if exists "payment_submissions_update_allowed" on public.payment_submissions;
create policy "payment_submissions_update_allowed" on public.payment_submissions
for update using (
  public.is_platform_admin()
  or public.can_access_property(property_id)
)
with check (
  public.is_platform_admin()
  or public.can_access_property(property_id)
);

drop policy if exists "payment_attachments_select_allowed" on public.payment_attachments;
create policy "payment_attachments_select_allowed" on public.payment_attachments
for select using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1 from public.payment_submissions submissions
    where submissions.id = payment_attachments.payment_submission_id
      and public.can_access_property(submissions.property_id)
  )
);

drop policy if exists "payment_attachments_insert_own" on public.payment_attachments;
create policy "payment_attachments_insert_own" on public.payment_attachments
for insert with check (tenant_id = auth.uid());

drop policy if exists "tenant_documents_storage_insert_own" on storage.objects;
create policy "tenant_documents_storage_insert_own" on storage.objects
for insert with check (
  bucket_id = 'tenant-documents'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "tenant_documents_storage_select_own" on storage.objects;
create policy "tenant_documents_storage_select_own" on storage.objects
for select using (
  bucket_id = 'tenant-documents'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "payment_receipts_storage_insert_own" on storage.objects;
create policy "payment_receipts_storage_insert_own" on storage.objects
for insert with check (
  bucket_id = 'payment-receipts'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "payment_receipts_storage_select_allowed" on storage.objects;
create policy "payment_receipts_storage_select_allowed" on storage.objects
for select using (
  bucket_id = 'payment-receipts'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);
