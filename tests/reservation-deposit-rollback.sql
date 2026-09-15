-- Integration assertions. ALWAYS roll back; never leaves a test booking/payment.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
do $$
declare
  actor uuid; room_row public.rooms%rowtype; booking uuid; payment_one uuid; payment_two uuid;
  blocked boolean; before_tenancies bigint; before_bills bigint;
begin
  select p.id into strict actor from public.profiles p join auth.users u on u.id=p.id where p.role='super_admin' limit 1;
  select r.* into strict room_row from public.rooms r join public.properties p on p.id=r.property_id
    where p.status='active' and p.property_code not in ('BDS','PTT') and r.status='vacant' and r.current_tenancy_id is null
    and not exists(select 1 from public.tenancies t where t.room_id=r.id and t.status='active')
    and not exists(select 1 from public.tenant_applications a where a.room_id=r.id and a.status in ('submitted','approved','pending_verification'))
    order by r.id limit 1 for update of r skip locked;
  select count(*) into before_tenancies from public.tenancies where room_id=room_row.id;
  select count(*) into before_bills from public.rent_bills where room_id=room_row.id;
  insert into public.tenant_applications(property_id,unit_id,room_id,submitted_by,full_name,registration_mode,status,monthly_rent,deposit,verification_status)
    values(room_row.property_id,room_row.unit_id,room_row.id,actor,'ROLLBACK ONLY reservation test','reservation','draft',350,150,'incomplete') returning id into booking;
  payment_one := public.submit_reservation_deposit(booking,actor,50,'2026-09-12',actor||'/admin-registration/'||booking||'/slip.png','slip.png','image/png','Rollback only');
  payment_two := public.submit_reservation_deposit(booking,actor,50,'2026-09-12',actor||'/admin-registration/'||booking||'/retry.png','retry.png','image/png','Retry');
  assert payment_one=payment_two, 'Retry created another payment';
  assert (select count(*) from public.payment_submissions where tenant_application_id=booking)=1, 'Duplicate payment';
  assert (select count(*) from public.payment_attachments where payment_submission_id=payment_one)=1, 'Duplicate attachment';
  assert (select status='reserved' and current_tenancy_id is null from public.rooms where id=room_row.id), 'Reservation became check-in';
  assert (select status='submitted' and verification_status='pending_verification' and payment_status='pending_verification' from public.tenant_applications where id=booking), 'Unexpected approval';
  assert (select amount=50 and verification_status='pending_verification' from public.payment_submissions where id=payment_one), 'Payment verified automatically';
  assert (select count(*) from public.tenancies where room_id=room_row.id)=before_tenancies, 'Tenancy created';
  assert (select count(*) from public.rent_bills where room_id=room_row.id)=before_bills, 'Invoice created';
  blocked := false;
  begin
    perform public.submit_reservation_deposit(booking,actor,100,'2026-09-12',actor||'/admin-registration/'||booking||'/slip.png','slip.png','image/png','Alter retry');
  exception when others then blocked := true;
  end;
  assert blocked, 'Changed amount was silently accepted';
  blocked := false;
  begin
    perform public.submit_reservation_deposit(booking,gen_random_uuid(),50,'2026-09-12',actor||'/admin-registration/'||booking||'/slip.png','slip.png','image/png','Wrong actor');
  exception when others then blocked := true;
  end;
  assert blocked, 'Wrong actor was accepted';
end $$;
rollback;
select 'PASS: one deposit, one attachment, retry idempotent, wrong actor/change blocked, no check-in or invoices; all test data rolled back' as result;
