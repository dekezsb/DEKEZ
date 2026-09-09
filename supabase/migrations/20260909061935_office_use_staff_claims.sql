alter table public.claims
  add column if not exists company_id uuid references public.companies(id) on delete restrict,
  alter column property_id drop not null,
  alter column owner_id drop not null;

update public.claims c set company_id = p.company_id
from public.properties p where c.property_id = p.id and c.company_id is null;

alter table public.claims add constraint claims_office_or_property_scope check (
  (property_id is not null and owner_id is not null)
  or (property_id is null and company_id is not null and owner_id is null
      and room_id is null and ticket_id is null)
);

insert into public.expense_categories(name, is_default)
select 'Office & Administration', true where not exists (
  select 1 from public.expense_categories where company_id is null and name = 'Office & Administration'
);

insert into public.accounting_category_mappings(company_id, source_type, source_key, account_id)
select a.company_id, 'expense_category', c.id::text, a.id
from public.accounting_accounts a cross join public.expense_categories c
where a.system_key = 'office_admin' and c.company_id is null
  and c.name = 'Office & Administration'
on conflict (company_id, source_type, source_key) do nothing;

create index if not exists claims_company_id_idx on public.claims(company_id);
-- Existing authenticated submitter and administrator policies remain in force.
