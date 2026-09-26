-- Reference changes only. Do not touch verification, invoice, receipt or AR state.
-- Filename aligned with the production migration history after approved release.
-- Existing folder rule: normalized reference unique within invoice/tenancy/record.
-- Existing reconciliation rule: company + payment date + amount + reference,
-- excluding sibling allocations of the SAME submission. No global QR uniqueness.
create or replace function public.guard_payment_reference_change()
returns trigger language plpgsql security invoker set search_path='' as $$
declare code text; company uuid;
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
    left join public.properties prop on prop.id=s.property_id
    where s.id<>new.id and s.verification_status<>'rejected'
      and upper(regexp_replace(coalesce(s.reference_number,''),'[^a-zA-Z0-9]','','g'))=code
      and (s.rent_bill_id=new.rent_bill_id or s.tenancy_id=new.tenancy_id or s.tenant_record_id=new.tenant_record_id
        or (prop.company_id=company and s.amount=new.amount and s.payment_date=new.payment_date)))
    or exists(select 1 from public.payments p where p.company_id=company
      and p.payment_submission_id is distinct from new.id and p.reversed_at is null and p.status in ('confirmed','paid')
      and p.amount=new.amount and p.payment_date=new.payment_date
      and upper(regexp_replace(coalesce(p.reference_number,''),'[^a-zA-Z0-9]','','g'))=code) then
    raise exception 'duplicate_bank_reference';
  end if;
  if exists(select 1 from public.payments p where p.payment_submission_id=new.id
    and nullif(btrim(p.reference_number),'') is not null
    and p.reference_number is distinct from old.reference_number
    and p.reference_number is distinct from new.reference_number) then
    raise exception 'reference_conflict';
  end if;
  return new;
end; $$;
create trigger guard_payment_reference_change before update of reference_number on public.payment_submissions
for each row execute function public.guard_payment_reference_change();

create or replace function public.sync_payment_reference_change()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.reference_number is distinct from old.reference_number then
    update public.payments set reference_number=new.reference_number
      where payment_submission_id=new.id and reference_number is distinct from new.reference_number;
  end if;
  return new;
end; $$;
create trigger sync_payment_reference_change after update of reference_number on public.payment_submissions
for each row execute function public.sync_payment_reference_change();

create or replace function public.save_payment_bank_reference(p_submission uuid,p_actor uuid,p_reference text,p_previous text)
returns text language plpgsql security invoker set search_path='' as $$
declare s public.payment_submissions%rowtype; code text; company uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor and
    (role in ('admin','super_admin') or global_role in ('admin','super_admin'))) then raise exception 'Forbidden'; end if;
  code:=btrim(p_reference);
  if nullif(code,'') is null or length(p_reference)>120 or p_reference ~ '[[:cntrl:]]'
    or length(regexp_replace(code,'[^a-zA-Z0-9]','','g'))<4 or code !~ '[0-9]' then raise exception 'invalid_bank_reference'; end if;
  select * into strict s from public.payment_submissions where id=p_submission for update;
  if s.reference_number=code then return code; end if;
  if coalesce(s.reference_number,'') is distinct from coalesce(p_previous,'') then raise exception 'reference_changed'; end if;
  select company_id into company from public.properties where id=s.property_id;
  if company is null then raise exception 'Payment unavailable'; end if;
  update public.payment_submissions set reference_number=code where id=s.id;
  insert into public.audit_logs(company_id,actor_profile_id,action,entity_table,entity_id,metadata)
    values(company,p_actor,'payment_bank_reference_updated','payment_submissions',s.id,
      jsonb_build_object('previous_reference',s.reference_number,'reference',code,'verification_status_unchanged',s.verification_status,'reference_only',true));
  return code;
end; $$;
revoke all on function public.guard_payment_reference_change() from public,anon,authenticated;
revoke all on function public.sync_payment_reference_change() from public,anon,authenticated;
revoke all on function public.save_payment_bank_reference(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.guard_payment_reference_change() to service_role;
grant execute on function public.sync_payment_reference_change() to service_role;
grant execute on function public.save_payment_bank_reference(uuid,uuid,text,text) to service_role;

-- Keep the existing idempotent folder verification; this only supplies its code.
create or replace function public.verify_payment_folder_slip_with_reference(p_submission uuid,p_actor uuid,p_reference text,p_previous text)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.payment_submissions%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_actor and
    (role in ('admin','super_admin') or global_role in ('admin','super_admin'))) then raise exception 'Forbidden'; end if;
  select * into strict s from public.payment_submissions where id=p_submission for update;
  if s.verification_status='verified' then return; end if;
  if nullif(btrim(p_reference),'') is not null then
    perform public.save_payment_bank_reference(p_submission,p_actor,p_reference,p_previous);
  elsif s.payment_method in ('bank_transfer','duitnow','online_payment','qr','qr_payment','duitnow_qr') then
    raise exception 'invalid_bank_reference';
  end if;
  perform public.verify_payment_folder_slip(p_submission,p_actor,'verified',null);
end; $$;
revoke all on function public.verify_payment_folder_slip_with_reference(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.verify_payment_folder_slip_with_reference(uuid,uuid,text,text) to service_role;
