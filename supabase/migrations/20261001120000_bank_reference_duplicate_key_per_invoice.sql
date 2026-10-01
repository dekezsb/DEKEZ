-- Reference changes only. Do not touch verification, invoice, receipt or AR state.
-- Do not touch the payment-verification page's existing check-in/rental colour coding.
--
-- Narrows the duplicate key in guard_payment_reference_change() from
-- 20260927140000_shared_bank_reference_multi_room_amount_cap.sql (approved 2026-10-01).
-- That version still raised duplicate_bank_reference whenever another payment
-- under the same code shared the tenancy OR tenant record, which blocks valid
-- sharing of one transfer across different invoices (e.g. two rent bills of the
-- same tenancy, or slips whose tenant record is shared). The tenant/person is
-- never a duplicate key: one payer may fund several rooms/invoices in one transfer.
--
-- Duplicate = the code applied twice to the SAME payment target:
--   * invoice payments: the same rent_bill_id (one room-month invoice);
--   * payments with no invoice (check-in / booking fees): the same slot, i.e.
--     same tenancy, application or tenant record AND same payment type AND
--     same bill month.
-- Every other reuse is allowed, capped by the matching bank transaction amount
-- (unchanged from 20260927140000).
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

  if exists(select 1 from public.payment_submissions s
      where s.id<>new.id and s.verification_status<>'rejected'
        and upper(regexp_replace(coalesce(s.reference_number,''),'[^a-zA-Z0-9]','','g'))=code
        and (s.rent_bill_id=new.rent_bill_id
          or (new.rent_bill_id is null and s.rent_bill_id is null
            and s.payment_type is not distinct from new.payment_type
            and s.bill_month is not distinct from new.bill_month
            and (s.tenancy_id=new.tenancy_id or s.tenant_application_id=new.tenant_application_id
              or s.tenant_record_id=new.tenant_record_id))))
    or exists(select 1 from public.payments p where p.company_id=company and p.payment_submission_id is null
      and p.reversed_at is null and p.status in ('confirmed','paid')
      and upper(regexp_replace(coalesce(p.reference_number,''),'[^a-zA-Z0-9]','','g'))=code
      and (p.rent_bill_id=new.rent_bill_id
        or (new.rent_bill_id is null and p.rent_bill_id is null
          and p.tenancy_id=new.tenancy_id and p.category is not distinct from new.payment_type))) then
    raise exception 'duplicate_bank_reference';
  end if;

  -- One bank transaction may fund multiple rooms or invoices. Total what this
  -- code already carries (company-wide, this save included) and compare with
  -- the real bank amount, when it can be identified.
  select coalesce(sum(s.amount),0) into total_allocated from public.payment_submissions s
    join public.properties prop on prop.id=s.property_id
    where s.id<>new.id and s.verification_status<>'rejected' and prop.company_id=company
      and upper(regexp_replace(coalesce(s.reference_number,''),'[^a-zA-Z0-9]','','g'))=code;
  total_allocated:=total_allocated+new.amount+coalesce((
    select sum(p.amount) from public.payments p where p.company_id=company and p.payment_submission_id is null
      and p.reversed_at is null and p.status in ('confirmed','paid')
      and upper(regexp_replace(coalesce(p.reference_number,''),'[^a-zA-Z0-9]','','g'))=code
  ),0);

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
