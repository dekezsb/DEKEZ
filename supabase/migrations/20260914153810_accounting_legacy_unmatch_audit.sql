-- Release legacy reconciliation links only, with explicit admin review and audit.
create index if not exists accounting_payment_reconciliations_company_idx on public.accounting_payment_reconciliations(company_id);
create function public.unreconcile_legacy_tenant_bank(p_company uuid,p_line uuid,p_actor uuid,p_reason text)
returns void language plpgsql security invoker set search_path=public as $$
declare old_links jsonb; affected uuid[]; statement uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  if not exists(select 1 from public.profiles where id=p_actor and role in ('super_admin','admin')) or coalesce(length(trim(p_reason)),0)<3 then raise exception 'Authorized admin and reason required'; end if;
  select l.statement_import_id into statement from public.bank_statement_lines l join public.bank_statement_imports s on s.id=l.statement_import_id
    where l.id=p_line and l.amount>0 and s.company_id=p_company and s.status<>'void' for update of l;
  if statement is null or not exists(select 1 from public.bank_reconciliation_matches where statement_line_id=p_line)
    or exists(select 1 from public.bank_reconciliation_matches where statement_line_id=p_line and source_type not in ('payment','rent_bill'))
    or exists(select 1 from public.accounting_payment_reconciliations where bank_transaction_id=p_line) then raise exception 'Use the appropriate reviewed unmatch action'; end if;
  select jsonb_agg(to_jsonb(m)) into old_links from public.bank_reconciliation_matches m where statement_line_id=p_line;
  select array_agg(distinct p.id) into affected from public.payments p join public.bank_reconciliation_matches m
    on (m.source_type='payment' and m.source_id=p.id) or (m.source_type='rent_bill' and m.source_id=p.rent_bill_id)
    where m.statement_line_id=p_line and p.company_id=p_company;
  delete from public.bank_reconciliation_matches where statement_line_id=p_line;
  update public.accounting_payment_reconciliations r set reconciliation_status=case when exists(
    select 1 from public.bank_reconciliation_matches m join public.payments p on p.id=r.payment_record_id
    where (m.source_type='payment' and m.source_id=p.id) or (m.source_type='rent_bill' and m.source_id=p.rent_bill_id)) then 'MANUAL_REVIEW' else 'UNMATCHED' end,updated_at=now()
    where r.payment_record_id=any(affected) and r.bank_transaction_id is null;
  update public.bank_statement_lines set status='unmatched',updated_at=now() where id=p_line;
  update public.bank_statement_imports set status='in_progress',reconciled_at=null,reconciled_by=null,updated_at=now() where id=statement;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,reason,performed_by)
    values(p_company,'payment_reconciliation',p_line,'legacy_unmatched',jsonb_build_object('links',old_links),p_reason,p_actor);
end;
$$;
revoke all on function public.unreconcile_legacy_tenant_bank(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.unreconcile_legacy_tenant_bank(uuid,uuid,uuid,text) to service_role;
