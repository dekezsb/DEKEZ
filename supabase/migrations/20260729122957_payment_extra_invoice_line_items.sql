create table if not exists public.rental_invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  rent_bill_id uuid not null references public.rent_bills(id) on delete cascade,
  payment_submission_id uuid references public.payment_submissions(id) on delete set null,
  category text not null,
  description text not null,
  amount numeric(12, 2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_invoice_line_items_category_check check (
    category in (
      'key_lock',
      'electricity',
      'water',
      'access_card',
      'damage',
      'cleaning',
      'other'
    )
  ),
  constraint rental_invoice_line_items_amount_check check (amount > 0)
);

create unique index if not exists rental_invoice_line_items_submission_unique
  on public.rental_invoice_line_items (payment_submission_id)
  where payment_submission_id is not null;

create index if not exists rental_invoice_line_items_bill_idx
  on public.rental_invoice_line_items (rent_bill_id, created_at);

alter table public.rental_invoice_line_items enable row level security;

drop policy if exists "rental_invoice_line_items_select_allowed"
  on public.rental_invoice_line_items;
create policy "rental_invoice_line_items_select_allowed"
on public.rental_invoice_line_items
for select
to authenticated
using (
  exists (
    select 1
    from public.rent_bills as bills
    left join public.tenancies as tenancies
      on tenancies.id = bills.tenancy_id
    left join public.tenants as tenants
      on tenants.id = tenancies.tenant_id
    where bills.id = rental_invoice_line_items.rent_bill_id
      and (
        public.can_manage_property_expenses(bills.property_id)
        or bills.tenant_id = auth.uid()
        or tenants.profile_id = auth.uid()
      )
  )
);

drop policy if exists "rental_invoice_line_items_manage_allowed"
  on public.rental_invoice_line_items;
create policy "rental_invoice_line_items_manage_allowed"
on public.rental_invoice_line_items
for all
to authenticated
using (
  exists (
    select 1
    from public.rent_bills as bills
    where bills.id = rental_invoice_line_items.rent_bill_id
      and public.can_manage_property_expenses(bills.property_id)
  )
)
with check (
  exists (
    select 1
    from public.rent_bills as bills
    where bills.id = rental_invoice_line_items.rent_bill_id
      and public.can_manage_property_expenses(bills.property_id)
  )
);

grant select, insert, update, delete
  on public.rental_invoice_line_items
  to authenticated;
