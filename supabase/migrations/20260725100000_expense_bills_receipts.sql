create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  maintenance_ticket_id uuid references public.maintenance_tickets(id) on delete set null,
  claim_id uuid references public.claims(id) on delete set null,
  category_id uuid references public.expense_categories(id) on delete set null,
  expense_date date not null default current_date,
  amount numeric(12, 2) not null check (amount >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  supplier text,
  description text,
  paid_by uuid references auth.users(id) on delete set null,
  payment_method text not null default 'cash' check (
    payment_method in ('cash', 'bank_transfer', 'duitnow', 'online_payment', 'cheque', 'card', 'other')
  ),
  charge_to text not null default 'company' check (charge_to in ('company', 'owner', 'tenant')),
  status text not null default 'pending_verification' check (
    status in ('draft', 'pending_verification', 'verified', 'rejected', 'reimbursed')
  ),
  tax_claimable boolean not null default false,
  receipt_number text,
  ocr_merchant text,
  ocr_receipt_date date,
  ocr_total_amount numeric(12, 2),
  ocr_tax_amount numeric(12, 2),
  ocr_receipt_number text,
  uploaded_by uuid references auth.users(id) on delete set null,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  bucket_name text not null default 'expense-receipts',
  file_path text not null,
  file_name text,
  content_type text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

insert into public.expense_categories (name, is_default)
select category_name, true
from unnest(array[
  'Repairs & Maintenance',
  'Cleaning',
  'Utilities',
  'Electricity',
  'Water',
  'Internet',
  'Supplies',
  'Furniture',
  'Equipment',
  'Petrol',
  'Transport',
  'Food',
  'Professional Fees',
  'Management Expenses',
  'Other'
]) as category_name
where not exists (
  select 1 from public.expense_categories existing
  where existing.company_id is null
    and lower(existing.name) = lower(category_name)
);

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_attachments enable row level security;

drop policy if exists "expense_categories_select_allowed" on public.expense_categories;
create policy "expense_categories_select_allowed" on public.expense_categories
for select using (
  public.is_platform_admin()
  or company_id is null
  or public.is_company_member(company_id)
);

drop policy if exists "expense_categories_manage_admin_owner" on public.expense_categories;
create policy "expense_categories_manage_admin_owner" on public.expense_categories
for all using (
  public.is_platform_admin()
  or company_id is null
  or public.can_manage_company(company_id)
)
with check (
  public.is_platform_admin()
  or company_id is null
  or public.can_manage_company(company_id)
);

drop policy if exists "expenses_select_allowed" on public.expenses;
create policy "expenses_select_allowed" on public.expenses
for select using (
  public.is_platform_admin()
  or uploaded_by = auth.uid()
  or (property_id is not null and public.can_access_property(property_id))
  or (company_id is not null and public.is_company_member(company_id))
);

drop policy if exists "expenses_insert_staff" on public.expenses;
create policy "expenses_insert_staff" on public.expenses
for insert with check (
  uploaded_by = auth.uid()
  and auth.uid() is not null
);

drop policy if exists "expenses_update_admin_owner" on public.expenses;
create policy "expenses_update_admin_owner" on public.expenses
for update using (
  public.is_platform_admin()
  or (property_id is not null and public.can_access_property(property_id))
  or (company_id is not null and public.can_manage_company(company_id))
)
with check (
  public.is_platform_admin()
  or (property_id is not null and public.can_access_property(property_id))
  or (company_id is not null and public.can_manage_company(company_id))
);

drop policy if exists "expense_attachments_select_allowed" on public.expense_attachments;
create policy "expense_attachments_select_allowed" on public.expense_attachments
for select using (
  public.is_platform_admin()
  or uploaded_by = auth.uid()
  or exists (
    select 1 from public.expenses
    where expenses.id = expense_attachments.expense_id
      and (
        expenses.uploaded_by = auth.uid()
        or (expenses.property_id is not null and public.can_access_property(expenses.property_id))
        or (expenses.company_id is not null and public.is_company_member(expenses.company_id))
      )
  )
);

drop policy if exists "expense_attachments_insert_owner" on public.expense_attachments;
create policy "expense_attachments_insert_owner" on public.expense_attachments
for insert with check (uploaded_by = auth.uid());

drop policy if exists "expense_receipts_storage_insert_own" on storage.objects;
create policy "expense_receipts_storage_insert_own" on storage.objects
for insert with check (
  bucket_id = 'expense-receipts'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "expense_receipts_storage_select_allowed" on storage.objects;
create policy "expense_receipts_storage_select_allowed" on storage.objects
for select using (
  bucket_id = 'expense-receipts'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);
