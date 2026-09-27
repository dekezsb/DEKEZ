-- Reference changes only. Do not touch verification, invoice, receipt or AR state.
-- Do not touch the payment-verification page's existing check-in/rental colour coding.
--
-- Supersedes the amount+date fallback in guard_payment_reference_change() from
-- 20260926132857_payment_slip_inline_bank_reference.sql. That fallback blocked
-- ANY second payment sharing a company+amount+date+bank code, even when the two
-- payments are for different rooms/invoices that were genuinely paid together
-- in one real bank transfer (e.g. a tenant renting two rooms who pays both in a
-- single transaction, verifying both with the same bank code - approved
-- 2026-09-27). A bank code is no longer blocked purely for being reused.
--
-- New rule: still block outright only when the SAME underlying record (tenancy,
-- rent bill or tenant record) is reusing the code - that is never a second room,
-- always an accidental re-save of the same real transaction. Otherwise, sum the
-- amounts already saved under this code (company-wide) plus this save, and only
-- block once that running total would exceed the real bank transaction's own
-- amount, when a matching bank_statement_lines row can identify it. When no such
-- bank line is on record, the total can't be checked against reality, so it is
-- allowed - consistent with "do not block just because it's already linked".
create or replace function public.guard_payment_reference_change()
returns trigger language plpgsql security invoker set search_path='' as $$
declare code text; company uuid; total_allocated numeric; bank_amount numeric; pattern text;
begin
  if new.reference_number is not distinct from old.reference_number then return new; end if;
  if length(new.reference_number)>120 or new.reference_number ~ '[[:cntrl:]]' then
    raise exception 'invalid_bank_reference';
  end if;
  code:=upper(regexp_replace(coalesce(new.reference_number,''),'[^a-zA-Z0-9]','','g'));
  if code='' then return new; end if;
  select company_id into company from public.properties where id=new.property_id;
  -- Serialize competing saves of the same code. Existing upload scope lock is
  -- also taken so uploads and inline saves cannot bypass the folder guard.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(new.tenancy_id,new.tenant_record_id,new.rent_bill_id,new.id)::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(company::text,'')||':bank-reference:'||code,0));

  -- Same tenancy / rent bill / tenant record reusing this exact code is always
  -- the same real transaction being re-saved by mistake, never a second room.
  if exists(select 1 from public.payment_submissions s
      where s.id<>new.id and s.verification_status<>'rejected'
        and upper(regexp_replace(coalesce(s.reference_number,''),'[^a-zA-Z0-9]','','g'))=code
        and (s.rent_bill_id=new.rent_bill_id or s.tenancy_id=new.tenancy_id or s.tenant_record_id=new.tenant_record_id))
    or exists(select 1 from public.payments p where p.company_id=company and p.payment_submission_id is null
      and p.reversed_at is null and p.status in ('confirmed','paid')
      and upper(regexp_replace(coalesce(p.reference_number,''),'[^a-zA-Z0-9]','','g'))=code
      and (p.rent_bill_id=new.rent_bill_id or p.tenancy_id=new.tenancy_id)) then
    raise exception 'duplicate_bank_reference';
  end if;

  -- Otherwise: one bank transaction may legitimately fund multiple rooms or
  -- invoices, so reusing the code elsewhere is allowed by default. Total what
  -- this code already carries (company-wide, this save included) and compare
  -- with the real bank amount, when it can be identified.
  select coalesce(sum(s.amount),0) into total_allocated from public.payment_submissions s
    join public.properties prop on prop.id=s.property_id
    where s.id<>new.id and s.verification_status<>'rejected' and prop.company_id=company
      and upper(regexp_replace(coalesce(s.reference_number,''),'[^a-zA-Z0-9]','','g'))=code;
  total_allocated:=total_allocated+new.amount+coalesce((
    select sum(p.amount) from public.payments p where p.company_id=company and p.payment_submission_id is null
      and p.reversed_at is null and p.status in ('confirmed','paid')
      and upper(regexp_replace(coalesce(p.reference_number,''),'[^a-zA-Z0-9]','','g'))=code
  ),0);

  -- Word-boundary match against the bank line's own reference/description text
  -- (same style as the property/room extraction in guard_existing_payment_bank_match),
  -- tolerant of spaces/slashes/hyphens between characters, not just an exact code match.
  -- string_to_array(code, NULL) splits into individual characters (an empty-string
  -- delimiter, unlike NULL, would NOT split at all and defeat the tolerance below).
  pattern:='\m'||array_to_string(string_to_array(code,null),'[\s/-]*')||'\M';
  select bsl.amount into bank_amount from public.bank_statement_lines bsl
    join public.bank_accounts ba on ba.id=bsl.bank_account_id
    where ba.company_id=company and concat_ws(' ',bsl.reference_number,bsl.description)~* pattern
    order by bsl.transaction_date desc limit 1;

  if bank_amount is not null and total_allocated>bank_amount+0.01 then
    raise exception 'bank_reference_exceeds_amount';
  end if;

  if exists(select 1 from public.payments p where p.payment_submission_id=new.id
    and nullif(btrim(p.reference_number),'') is not null
    and p.reference_number is distinct from old.reference_number
    and p.reference_number is distinct from new.reference_number) then
    raise exception 'reference_conflict';
  end if;
  return new;
end; $$;
