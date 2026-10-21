-- Deployment configuration only: the audited existing September source IDs.
-- This inserts immutable scope metadata, not payments or accounting entries.
with approved(id,maximum_remaining) as (values
  ('7fc17b75-248f-432b-ad41-8397da2b68c7'::uuid,100::numeric),
  ('a34eaff2-54fa-4da2-beeb-7a5023050c9a'::uuid,600::numeric),
  ('5cfc4c7c-6c15-4bec-9cbc-99a5d81fc65e'::uuid,30::numeric),
  ('aa14d1b3-d728-4727-b40a-6ebb0925bc6b'::uuid,100::numeric),
  ('c05acb82-ff63-4e12-9511-a4491c7393bf'::uuid,100::numeric),
  ('95528596-e62a-4654-967b-fe7e116c9e0f'::uuid,50::numeric),
  ('13ee8e0e-7fc3-4786-8e3f-1fc129093181'::uuid,430::numeric),
  ('98da8daf-aedb-4788-ada8-1e885a7568a0'::uuid,250::numeric),
  ('e9ae55f6-1fbd-4dd8-8061-f73f3bd0d26c'::uuid,380::numeric),
  ('4ffe381f-61c3-4077-b252-da7aff95e0ea'::uuid,350::numeric),
  ('1861ec9e-8d85-44ac-812a-f240da8d323a'::uuid,1100::numeric),
  ('957cec12-b229-4663-a183-93a835a898d8'::uuid,50::numeric),
  ('01b384ac-50cf-41af-9ad7-3d6ab1828cab'::uuid,350::numeric),
  ('240dbc4c-fbfa-4239-9783-fd915f45cc1a'::uuid,480::numeric),
  ('5cf61009-88e3-452c-ac8d-cf1dceffb612'::uuid,550::numeric),
  ('ce616a46-bff0-4853-97c0-e67e27b7e424'::uuid,570::numeric),
  ('a2886259-9905-4573-9aed-f1a5d4504371'::uuid,480::numeric),
  ('b59374c0-557a-4a6c-a429-f3e8d0440433'::uuid,50::numeric),
  ('c7967eb4-9e2a-475b-9044-056c0d685b38'::uuid,330::numeric),
  ('0a72970a-3745-4944-b92f-3e494ed3f3ba'::uuid,100::numeric),
  ('dc16a5b3-1c79-4e43-922f-8d8e6d599f03'::uuid,50::numeric),
  ('3ad3120f-33be-4913-8deb-5fab06d5c612'::uuid,1575::numeric),
  ('8b2ff825-f8b4-49c9-994c-31d9690e0887'::uuid,50::numeric),
  ('96209c5b-2427-477e-bb03-8a7ec11f7014'::uuid,130::numeric),
  ('722501ce-12ee-4f09-b6e4-8dc2877d14d9'::uuid,359::numeric),
  ('b48b5e2d-7fbb-4d8e-9084-0b24dcd107c4'::uuid,350::numeric),
  ('be2b5683-10b5-4708-9954-b0fc624376c3'::uuid,30::numeric),
  ('b367e528-a00e-4bf3-812f-0f404e43981c'::uuid,500::numeric),
  ('cc342b65-bb4e-48e8-a96c-6581ee1c607b'::uuid,100::numeric),
  ('f203df8e-889d-455f-8d52-b414c9336407'::uuid,350::numeric),
  ('0ab6989a-0174-43d7-9071-a2166f22eab1'::uuid,400::numeric),
  ('444ec8a1-8ad5-40cd-95ed-4628208606b5'::uuid,50::numeric),
  ('466a6a6e-fcb9-4342-ad28-93507ac62431'::uuid,300::numeric),
  ('50a0f1ee-5d7c-4bec-b4e2-a9c0b2e21531'::uuid,50::numeric),
  ('944ae51f-39db-4cbf-a295-205ac235f64d'::uuid,50::numeric),
  ('b7f355b5-19c0-49c1-80a4-37999dd2830b'::uuid,100::numeric),
  ('ea3e1b3e-f4a4-427d-80bb-435e3945499d'::uuid,50::numeric)
)
insert into public.september_credit_cleanup_scope
  (statement_line_id,company_id,bank_account_id,captured_remaining,source_snapshot)
select bl.id,s.company_id,bl.bank_account_id,
  least(approved.maximum_remaining,bl.amount-coalesce((select sum(matched_amount) from public.bank_reconciliation_matches where statement_line_id=bl.id),0)),to_jsonb(bl)
from public.bank_statement_lines bl join public.bank_statement_imports s on s.id=bl.statement_import_id
join approved on approved.id=bl.id
where s.company_id='660cc0c4-daee-445b-9146-ccd112e791d4'
  and bl.bank_account_id='61998a10-c883-421b-b117-6c82cadf464b'
  and bl.transaction_date>=date '2026-09-01' and bl.transaction_date<date '2026-10-01'
  and bl.created_at<=timestamptz '2026-10-21 17:05:37+00'
  and bl.amount>0 and bl.duplicate_of_line_id is null and s.status='in_progress'
  and bl.status not in ('matched','adjusted','ignored')
  and bl.amount>coalesce((select sum(matched_amount) from public.bank_reconciliation_matches where statement_line_id=bl.id),0);
