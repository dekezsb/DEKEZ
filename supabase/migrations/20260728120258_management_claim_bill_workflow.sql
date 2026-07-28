alter table public.claims
  alter column ticket_id drop not null,
  add column if not exists room_id uuid references public.rooms(id) on delete set null,
  add column if not exists funding_source text not null default 'company_cash';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'claims_funding_source_check'
      and conrelid = 'public.claims'::regclass
  ) then
    alter table public.claims
      add constraint claims_funding_source_check
      check (funding_source in ('company_cash', 'staff_personal'));
  end if;
end
$$;

create index if not exists claims_room_id_idx
  on public.claims (room_id);

create unique index if not exists expenses_claim_id_unique
  on public.expenses (claim_id)
  where claim_id is not null;

create unique index if not exists expense_attachments_expense_file_unique
  on public.expense_attachments (expense_id, file_path);

grant select, insert, update on table public.claims to authenticated;
